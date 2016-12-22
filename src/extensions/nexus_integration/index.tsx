import NXMUrl from './NXMUrl';
import { accountReducer } from './reducers/account';
import { settingsReducer } from './reducers/settings';
import LoginIcon from './views/LoginIcon';
import Settings from './views/Settings';

import { retriveCategoryList } from '../category_management/util/retrieveCategories';

import { showDialog } from '../../actions/notifications';
import { IExtensionApi, IExtensionContext } from '../../types/IExtensionContext';
import { log } from '../../util/log';
import { getSafe } from '../../util/storeHelper';
import InputButton from '../../views/InputButton';
import { IconButton } from '../../views/TooltipControls';

import * as Promise from 'bluebird';
import Nexus, { IDownloadURL, IFileInfo } from 'nexus-api';
import * as util from 'util';

let nexus: Nexus;

export interface IExtensionContextExt extends IExtensionContext {
  registerDownloadProtocol: (schema: string,
    handler: (inputUrl: string) => Promise<string[]>) => void;
}

function convertGameId(input: string): string {
  if (input === 'SkyrimSE') {
    return 'skyrimspecialedition';
  } else {
    return input;
  }
}

function startDownload(api: IExtensionApi, nxmurl: string) {
  const url: NXMUrl = new NXMUrl(nxmurl);

  let nexusFileInfo: IFileInfo;

  let gameId = convertGameId(url.gameId);

  nexus.getFileInfo(url.modId, url.fileId, gameId)
    .then((fileInfo: IFileInfo) => {
      nexusFileInfo = fileInfo;
      api.sendNotification({
        id: url.fileId.toString(),
        type: 'global',
        title: 'Downloading from Nexus',
        message: fileInfo.name,
        displayMS: 4000,
      });
      return nexus.getDownloadURLs(url.modId, url.fileId, gameId);
    })
    .then((urls: IDownloadURL[]) => {
      if (urls === null) {
        throw { message: 'No download locations (yet)' };
      }
      let uris: string[] = urls.map((item: IDownloadURL) => item.URI);
      log('debug', 'got download urls', { uris });
      api.events.emit('start-download', uris, {
        game: url.gameId.toLowerCase(),
        nexus: {
          ids: { gameId, modId: url.modId, fileId: url.fileId },
          fileInfo: nexusFileInfo,
        },
      });
    })
    .catch((err) => {
      api.sendNotification({
        id: url.fileId.toString(),
        type: 'global',
        title: 'Download failed',
        message: err.message,
        displayMS: 2000,
      });
      log('warn', 'failed to get mod info', { err: util.inspect(err) });
    });
}

function retrieveCategories(context: IExtensionContextExt, isUpdate: boolean) {

  if (isUpdate !== false) {
    context.api.store.dispatch(
      showDialog('question', 'Retrieve Categories', {
        message: 'Clicking RETRIEVE you will lose all your changes',
      }, {
          Cancel: null,
          Retrieve:
          () => {
            let gameId: string = convertGameId(getSafe(context.api.store.getState(),
              ['settings', 'gameMode', 'current'], ''));
            retriveCategoryList(gameId, nexus)
              .then((result: any) => {
                context.api.events.emit('retrieve-categories', [gameId, result, isUpdate], {});
              });
          },
        }));
  } else {
    let gameId: string = convertGameId(getSafe(context.api.store.getState(),
      ['settings', 'gameMode', 'current'], ''));
    retriveCategoryList(gameId, nexus)
      .then((result: any) => {
        // context.api.events.emit('retrieve-categories', [gameId, result, isUpdate], {});
        context.api.events.emit('retrieve-categories', [gameId, result, isUpdate], {});
      });
  }
};

function init(context: IExtensionContextExt): boolean {
  context.registerFooter('login', LoginIcon, () => ({ nexus }));
  context.registerSettings('Download', Settings);
  context.registerReducer(['account', 'nexus'], accountReducer);
  context.registerReducer(['settings', 'nexus'], settingsReducer);

  if (context.registerDownloadProtocol !== undefined) {
    context.registerDownloadProtocol('nxm:', (nxmurl: string): Promise<string[]> => {
      const nxm: NXMUrl = new NXMUrl(nxmurl);
      return nexus.getDownloadURLs(nxm.modId, nxm.fileId, convertGameId(nxm.gameId))
        .map((url: IDownloadURL): string => {
          return url.URI;
        });
    });
  }

  let onStartDownload = (nxmurl: string) => {
    startDownload(context.api, nxmurl);
  };

  let onRetrieveCategories = (isUpdate: boolean) => {
    retrieveCategories(context, isUpdate);
  };

  context.registerIcon('download-icons', InputButton,
    () => ({
      key: 'input-nxm-url',
      id: 'input-nxm-url',
      groupId: 'download-buttons',
      icon: 'nexus',
      tooltip: 'Download NXM URL',
      onConfirmed: onStartDownload,
    }));

  context.registerIcon('categories-icons', IconButton,
    () => ({
      key: 'retrieve-categories',
      id: 'retrieve-categories',
      icon: 'download',
      tooltip: 'Retrieve categories',
      onClick: onRetrieveCategories,
    }));

  context.once(() => {
    let state = context.api.store.getState();
    nexus = new Nexus(
      getSafe(state, ['settings', 'gameMode', 'current'], ''),
      getSafe(state, ['account', 'nexus', 'APIKey'], '')
    );
    let registerFunc = () => {
      context.api.registerProtocol('nxm', (url: string) => {
        startDownload(context.api, url);
      });
    };
    if (context.api.store.getState().settings.nexus.associateNXM) {
      registerFunc();
    }

    context.api.events.on('retrieve-category-list', (isUpdate: boolean) => {
      onRetrieveCategories(isUpdate);
    });

    context.api.onStateChange(['settings', 'nexus', 'associateNXM'],
      (oldValue: boolean, newValue: boolean) => {
        log('info', 'associate', { oldValue, newValue });
        if (newValue === true) {
          registerFunc();
        } else {
          context.api.deregisterProtocol('nxm');
        }
      }
    );

    context.api.onStateChange(['settings', 'gameMode', 'current'],
      (oldValue: string, newValue: string) => {
        nexus.setGame(newValue);
      });

    context.api.onStateChange(['account', 'nexus', 'APIKey'],
      (oldValue: string, newValue: string) => {
        nexus.setKey(newValue);
      });
  });

  return true;
}

export default init;
