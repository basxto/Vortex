import { ButtonType } from '../../../controls/IconBar';
import ToolbarDropdown from '../../../controls/ToolbarDropdown';
import ToolbarIcon from '../../../controls/ToolbarIcon';
import { ComponentEx, connect, translate } from '../../../util/ComponentEx';
import { activeGameId } from '../../../util/selectors';
import { getSafe } from '../../../util/storeHelper';

import { IProfileMod } from '../../profile_management/types/IProfile';

import { IMod } from '../types/IMod';

import * as React from 'react';

export type IModWithState = IMod & IProfileMod;

export interface IBaseProps {
  buttonType: ButtonType;
}

interface IConnectedProps {
  mods: { [modId: string]: IMod };
  gameMode: string;
  updateRunning: boolean;
}

type IProps = IBaseProps & IConnectedProps;

class CheckVersionsButton extends ComponentEx<IProps, {}> {
  public render(): JSX.Element {
    const { t, updateRunning } = this.props;

    if (updateRunning) {
      return (
        <ToolbarIcon
          id='check-mods-version'
          icon='spinner'
          text={t('Checking for mod updates')}
          disabled={true}
          spin
        />
      );
    } else {
      const id = 'check-mod-updates-button';

      return (
        <ToolbarDropdown
          key={id}
          id={id}
          instanceId={[]}
          icons={[
            {
              icon: 'refresh',
              title: t('Check for Mod Updates (Optimized)'),
              action: this.checkModsVersion,
              default: true,
            }, {
              icon: 'refresh',
              title: t('Check for Mod Updates (Full)'),
              action: this.checkForUpdateForce,
            },
          ]}
          buttonType={'icon'}
          orientation={'horizontal'}
        />
      );
    }
  }

  private checkModsVersion = () => {
    const { gameMode, mods } = this.props;

    this.context.api.emitAndAwait('check-mods-version', gameMode, mods)
      .then(() => {
        this.context.api.sendNotification({
          type: 'success',
          message: 'Check for mod updates complete',
          displayMS: 5000,
        });
      });
  }

  private checkForUpdateForce = () => {
    const { gameMode, mods } = this.props;

    this.context.api.emitAndAwait('check-mods-version', gameMode, mods, true)
      .then(() => {
        this.context.api.sendNotification({
          type: 'success',
          message: 'Check for mod updates complete',
          displayMS: 5000,
        });
      });
  }
}

const emptyObject = {};

function mapStateToProps(state: any): IConnectedProps {
  const gameMode = activeGameId(state);
  return {
    mods: getSafe(state, ['persistent', 'mods', gameMode], emptyObject),
    gameMode,
    updateRunning: getSafe(state, ['session', 'mods', 'updatingMods', gameMode], false),
  };
}

export default
  translate(['common'])(
    connect(mapStateToProps)(
      CheckVersionsButton)) as React.ComponentClass<IBaseProps>;
