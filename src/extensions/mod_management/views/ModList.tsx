import { showDialog } from '../../../actions/notifications';
import { IAttributeState } from '../../../types/IAttributeState';
import { DialogActions, DialogType, IDialogContent, IDialogResult } from '../../../types/IDialog';
import { IIconDefinition } from '../../../types/IIconDefinition';
import { IState } from '../../../types/IState';
import { ITableAttribute } from '../../../types/ITableAttribute';
import { ComponentEx, connect, extend, translate } from '../../../util/ComponentEx';
import { activeGameId, activeProfile } from '../../../util/selectors';
import { getSafe } from '../../../util/storeHelper';
import IconBar from '../../../views/IconBar';
import MainPage from '../../../views/MainPage';
import SuperTable, { ITableRowAction } from '../../../views/Table';
import TextFilter from '../../../views/table/TextFilter';

import { setModEnabled } from '../../profile_management/actions/profiles';
import { IProfileMod } from '../../profile_management/types/IProfile';

import { removeMod, setModAttribute } from '../actions/mods';
import { IMod } from '../types/IMod';
import { IModProps } from '../types/IModProps';
import { IVersion, IVersionIcon } from '../types/IVersion';
import retrieveNewModsWithState from '../util/retrieveNewModsWithState';
import VersionChangelogButton from '../views/VersionChangelogButton';
import VersionIconButton from '../views/VersionIconButton';

import { INSTALL_TIME } from '../modAttributes';
import { installPath } from '../selectors';

import CheckModVersionsButton from './CheckModVersionsButton';
import InstallArchiveButton from './InstallArchiveButton';

import * as Promise from 'bluebird';
import * as fs from 'fs-extra-promise';
import * as path from 'path';
import * as React from 'react';
import { ButtonGroup, DropdownButton, Jumbotron, MenuItem } from 'react-bootstrap';
import * as semver from 'semver';

type IModWithState = IMod & IProfileMod;

interface IBaseProps {
  objects: ITableAttribute[];
  globalOverlay: JSX.Element;
}

interface IAttributeStateMap {
  [attributeId: string]: IAttributeState;
}

interface IConnectedProps extends IModProps {
  gameMode: string;
  profileId: string;
  language: string;
  installPath: string;
}

interface IActionProps {
  onSetModAttribute: (gameMode: string, modId: string, attributeId: string, value: any) => void;
  onSetModEnabled: (profileId: string, modId: string, enabled: boolean) => void;
  onShowDialog: (type: DialogType, title: string, content: IDialogContent,
    actions: DialogActions) => Promise<IDialogResult>;
  onRemoveMod: (gameMode: string, modId: string) => void;
}

type IProps = IBaseProps & IConnectedProps & IActionProps;

/**
 * displays the list of mods installed for the current game.
 * 
 */
class ModList extends ComponentEx<IProps, {}> {
  private modActions: ITableRowAction[];
  private modEnabledAttribute: ITableAttribute;
  private modNameAttribute: ITableAttribute;
  private modVersionAttribute: ITableAttribute;
  private modVersionDetailAttribute: ITableAttribute;
  private mModsWithState: { [id: string]: IModWithState };
  private staticButtons: IIconDefinition[];

  private modAction: string = '';

  constructor(props: IProps) {
    super(props);

    this.modNameAttribute = {
      id: 'name',
      name: 'Mod Name',
      description: 'Name of the mod',
      icon: 'quote-left',
      calc: (mod: IMod) =>
        getSafe(mod.attributes, ['customFileName'],
          getSafe(mod.attributes, ['logicalFileName'],
            getSafe(mod.attributes, ['name'], '')
          )
        ),
      placement: 'both',
      isToggleable: false,
      edit: {
        onChangeValue: (modId: string, value: any) =>
          props.onSetModAttribute(props.gameMode, modId, 'customFileName', value),
      },
      isSortable: true,
      filter: new TextFilter(true),
      sortFunc: (lhs: string, rhs: string, locale: string): number => {
        return lhs.localeCompare(rhs, locale, { sensitivity: 'base' });
      },
    };

    this.modEnabledAttribute = {
      id: 'enabled',
      name: 'Enabled',
      description: 'Is mod enabled in current profile',
      icon: 'check-o',
      calc: (mod: IModWithState) => mod.enabled || false,
      placement: 'table',
      isToggleable: false,
      edit: {
        onChangeValue: (modId: string, value: any) => {
          props.onSetModEnabled(props.profileId, modId, value);
          this.context.api.events.emit('mods-enabled', [modId], value);
        },
      },
      isSortable: false,
    };

    this.modVersionDetailAttribute = {
      id: 'versionDetail',
      name: 'Version',
      description: 'File version (according to the author)',
      icon: 'birthday-cake',
      calc: (mod: IMod) => getSafe(mod.attributes, ['version'], ''),
      placement: 'detail',
      isToggleable: false,
      edit: {
        validate: (input: string) => semver.valid(input) ? 'success' : 'warning',
        onChangeValue: (modId: string, value: any) =>
          props.onSetModAttribute(props.gameMode, modId, 'version', value),
      },
      isSortable: false,
    };

    this.modVersionAttribute = {
      id: 'version',
      name: 'Version',
      description: 'File version (according to the author)',
      icon: 'birthday-cake',
      calc: (mod: IMod) => getSafe(mod.attributes, ['version'], ''),
      customRenderer: (mod: IMod) =>
        this.renderVersion(mod),
      placement: 'table',
      isToggleable: true,
      edit: {},
      isSortable: true,
    };

    this.modActions = [
      {
        icon: 'check-square-o',
        title: 'Enable selected',
        action: this.enableSelected,
        singleRowAction: false,
      },
      {
        icon: 'square-o',
        title: 'Disable selected',
        action: this.disableSelected,
        singleRowAction: false,
      },
      {
        icon: 'remove',
        title: 'Remove',
        action: this.removeSelected,
      },
    ];

    this.staticButtons = [
      {
        component: InstallArchiveButton,
        props: () => ({}),
      },
      {
        component: CheckModVersionsButton,
        props: () => ({}),
      },
    ];
  }

  public componentWillMount() {
    this.updateModsWithState({ mods: {}, modState: {} }, this.props);
  }

  public updateModsWithState(oldProps: IModProps, newProps: IModProps) {
    let newModsWithState = retrieveNewModsWithState(
      oldProps,
      newProps,
      this.mModsWithState,
      this.modAction);
    this.mModsWithState = newModsWithState;
  }

  public componentWillReceiveProps(newProps: IProps) {
    if ((this.props.mods !== newProps.mods)
      || (this.props.modState !== newProps.modState)) {
      this.updateModsWithState(this.props, newProps);
    }
  }

  public render(): JSX.Element {
    const { t, gameMode } = this.props;

    if (gameMode === undefined) {
      return <Jumbotron>{t('Please select a game first')}</Jumbotron>;
    }

    return (
      <MainPage>
        <MainPage.Body>
          <SuperTable
            tableId='mods'

            data={this.mModsWithState}
            staticElements={[
              this.modEnabledAttribute,
              this.modNameAttribute,
              this.modVersionAttribute,
              this.modVersionDetailAttribute,
              INSTALL_TIME,
            ]}
            actions={this.modActions}
          />
        </MainPage.Body>
        <MainPage.Overlay>
          <IconBar
            group='mod-icons'
            staticElements={this.staticButtons}
            buttonType='text'
            style={{ width: '100%', display: 'flex' }}
          />
          {this.props.globalOverlay}
        </MainPage.Overlay>
      </MainPage>
    );
  }

  private renderVersion = (mod: IMod): JSX.Element => {

    const { mods, modState } = this.props;
    const nexusModId: number = parseInt(getSafe(mod.attributes, ['modId'], '0'), 10);
    let versions: IVersion[] = [];
    let selectedVersion: string = '';

    Object.keys(mods).forEach(key => {
      if (getSafe(mods[key].attributes, ['modId'], undefined) === nexusModId) {
        let version: IVersion = {
          version: getSafe(mods[key].attributes, ['version'], undefined),
          mod: key,
        };
        versions.push(version);
        if (getSafe(modState, [key, 'enabled'], false)) {
          selectedVersion = key;
        }
      }
    });

    if (selectedVersion === '') {
      selectedVersion = mod.id;
    }

    const version = getSafe(mods[selectedVersion].attributes, ['version'], undefined);
    const fileId = getSafe(mods[selectedVersion].attributes, ['fileId'], '');
    const newestFileId = getSafe(mods[selectedVersion].attributes, ['newestFileId'], undefined);
    const bugMessage = getSafe(mods[selectedVersion].attributes, ['bugMessage'], '');
    const fileCategory: string = getSafe(mods[selectedVersion].attributes,
      ['fileCategory'], undefined);
    const isPrimary: boolean = getSafe(mods[selectedVersion].attributes, ['isPrimary'], undefined);

    let versionIcon: IVersionIcon;

    if (fileCategory !== 'MAIN' && !isPrimary) {
      if (bugMessage !== '') {
        if (newestFileId === undefined) {
          versionIcon = {
            icon: 'ban',
            tooltip: 'Mod should be disabled because this version is '
            + 'bugged and there is no update',
            classname: 'mod-updating-ban',
          };
        } else {
          versionIcon = {
            icon: 'bug',
            tooltip: 'Mod should be updated because the installed version is bugged',
            classname: 'mod-updating-bug',
          };
        }
      } else if (newestFileId !== undefined) {
        if (newestFileId !== 0 && newestFileId !== fileId) {
          versionIcon = {
            icon: 'cloud-download',
            tooltip: 'Mod can be updated',
            classname: 'mod-updating-download',
          };
        } else if (newestFileId === 0 && fileId !== undefined && version !== undefined) {
          versionIcon = {
            icon: 'external-link',
            tooltip: 'Mod can be updated (but you will have to pick the file yourself)',
            classname: 'mod-updating-warning',
          };
        }
      }
    }

    return (
      <div className={versionIcon !== undefined ? versionIcon.classname : null}>
        {this.renderVersionParams(versions, selectedVersion, mod, version,
          versionIcon, nexusModId, newestFileId)}
      </div>
    );
  }

  private renderVersionParams(
    versions: IVersion[],
    selectedVersion: string,
    mod: IMod,
    version: string,
    versionIcon: IVersionIcon,
    nexusModId: number,
    newestFileId: string): JSX.Element {

    const { gameMode } = this.props;

    if (versions.length === 0) {
      return (
        <div>
          {version}
        </div>
      );
    } else if (versions.length < 2) {
      return (
        <div>
          {versions[0].version}
          <ButtonGroup id={selectedVersion}>
            <VersionIconButton
              newestFileId={newestFileId}
              nexusModId={nexusModId}
              versionIcon={versionIcon}
              gameMode={gameMode}
              api={this.context.api}
            />
            <VersionChangelogButton
              mod={mod}
            />
          </ButtonGroup>
        </div>);
    } else {
      return (
        <ButtonGroup id={selectedVersion}>
          <DropdownButton
            title={version}
            id={selectedVersion}
            onChange={this.selectVersion}
            onSelect={this.selectVersion}
          >
            {versions.map((ver) => { return this.renderVersionOptions(ver, selectedVersion); })}
          </DropdownButton>
          <VersionIconButton
            newestFileId={newestFileId}
            nexusModId={nexusModId}
            versionIcon={versionIcon}
            gameMode={gameMode}
            api={this.context.api}
          />
          <VersionChangelogButton
            mod={mod}
          />
        </ButtonGroup>
      );
    }
  }

  private renderVersionOptions(version: IVersion, selectedVersion: string): JSX.Element {
    let versionOptions: { oldVersion: string, newVersion: string } = {
      oldVersion: selectedVersion,
      newVersion: version.mod,
    };

    return (
      <MenuItem eventKey={versionOptions} value={version.mod} key={version.mod}>
        {version.version}
      </MenuItem>
    );
  }

  private selectVersion = (evt) => {
    const { profileId, modState, onSetModEnabled } = this.props;
    let oldVersion = evt.oldVersion;
    let newVersion = evt.newVersion;

    this.modAction = 'enabling';

    if (oldVersion !== newVersion) {
      if (getSafe(modState, [oldVersion, 'enabled'], false)) {
        onSetModEnabled(profileId, oldVersion, false);
      }
      this.context.api.events.emit('mods-enabled', [oldVersion], false);

      if (!getSafe(modState, [newVersion, 'enabled'], false)) {
        onSetModEnabled(profileId, newVersion, true);
      }
      this.context.api.events.emit('mods-enabled', [newVersion], true);
    }
  }

  private enableSelected = (modIds: string[]) => {
    const { profileId, modState, onSetModEnabled } = this.props;
    this.modAction = 'enabling';

    modIds.forEach((key: string) => {
      if (!getSafe(modState, [key, 'enabled'], false)) {
        onSetModEnabled(profileId, key, true);
      }
    });
    this.context.api.events.emit('mods-enabled', modIds, true);
  }

  private disableSelected = (modIds: string[]) => {
    this.modAction = 'enabling';
    this.disableModsInner(modIds);
    this.context.api.events.emit('mods-enabled', modIds, false);
  }

  private disableModsInner(modIds: string[]) {
    const { profileId, modState, onSetModEnabled } = this.props;
    modIds.forEach((key: string) => {
      if (getSafe(modState, [key, 'enabled'], false)) {
        onSetModEnabled(profileId, key, false);
      }
    });
  }

  private removeSelected = (modIds: string[]) => {
    const { t, gameMode, installPath, onRemoveMod, onShowDialog, mods } = this.props;
    this.modAction = 'removing';

    let removeMods: boolean;
    let removeArchive: boolean;
    let disableDependent: boolean;

    onShowDialog('question', 'Confirm deletion', {
      message: t('Do you really want to delete this mod?',
        { count: modIds.length, replace: { count: modIds.length } }) + '\n' + modIds.join('\n'),
      checkboxes: [
        { id: 'mod', text: t('Remove Mod'), value: true },
        { id: 'archive', text: t('Remove Archive'), value: false },
        { id: 'dependents', text: t('Disable Dependent'), value: false },
      ],
    }, {
        Cancel: null,
        Remove: null,
      }).then((result: IDialogResult) => {
        removeMods = result.action === 'Remove' && result.input.mod;
        removeArchive = result.action === 'Remove' && result.input.archive;
        disableDependent = result.action === 'Remove' && result.input.dependents;

        if (removeMods) {
          this.disableModsInner(modIds);
          return new Promise<void>((resolve, reject) => {
            this.context.api.events.emit('activate-mods', (err: Error) => {
              if (err === null) {
                resolve();
              } else {
                reject(err);
              }
            });
          })
            .then(() => Promise.map(modIds, (key: string) => {
              let fullPath = path.join(installPath, mods[key].installationPath);
              return fs.removeAsync(fullPath);
            }))
            .then(() => undefined);
        } else {
          return Promise.resolve();
        }
      })
      .then(() => {
        modIds.forEach((key: string) => {
          if (removeMods) {
            onRemoveMod(gameMode, key);
          }
          if (removeArchive) {
            this.context.api.events.emit('remove-download', mods[key].archiveId);
          }
        });
      });
  }
}

function mapStateToProps(state: IState): IConnectedProps {
  const profile = activeProfile(state);
  const gameMode = activeGameId(state);

  return {
    mods: state.persistent.mods[gameMode] || {},
    modState: profile !== undefined ? profile.modState : {},
    gameMode,
    profileId: profile.id,
    language: state.settings.interface.language,
    installPath: installPath(state),
  };
}

function mapDispatchToProps(dispatch: Redux.Dispatch<any>): IActionProps {
  return {
    onSetModAttribute: (gameMode: string, modId: string, attributeId: string, value: any) => {
      dispatch(setModAttribute(gameMode, modId, attributeId, value));
    },
    onSetModEnabled: (profileId: string, modId: string, enabled: boolean) => {
      dispatch(setModEnabled(profileId, modId, enabled));
    },
    onShowDialog:
    (type, title, content, actions) => dispatch(showDialog(type, title, content, actions)),
    onRemoveMod: (gameMode: string, modId: string) => dispatch(removeMod(gameMode, modId)),
  };
}

function registerModAttribute(instance: ModList, attribute: ITableAttribute) {
  return attribute;
}

export default
  translate(['common'], { wait: false })(
    connect(mapStateToProps, mapDispatchToProps)(
      extend(registerModAttribute)(ModList)
    )
  ) as React.ComponentClass<{}>;
