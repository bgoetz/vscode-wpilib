'use strict';
import * as fs from 'fs';
import * as jsonc from 'jsonc-parser';
import * as path from 'path';
import * as vscode from 'vscode';
import { IPreferences } from './shared/externalapi';
import { promisifyMkDir, promisifyWriteFile } from './utilities';

interface IPreferencesJson {
  currentLanguage: string;
}

const defaultPreferences: IPreferencesJson = {
  currentLanguage: 'none',
};

export async function requestTeamNumber(): Promise<number> {
  const teamNumber = await vscode.window.showInputBox({ prompt: 'Enter your team number' });
  if (teamNumber === undefined) {
    return -1;
  }
  return parseInt(teamNumber, 10);
}

export class Preferences implements IPreferences {
  public workspace: vscode.WorkspaceFolder;
  private preferencesFile?: vscode.Uri;
  private readonly configFolder: string;
  private readonly preferenceFileName: string = 'wpilib_preferences.json';
  private preferencesJson: IPreferencesJson;
  private configFileWatcher: vscode.FileSystemWatcher;
  private readonly preferencesGlob: string = '**/' + this.preferenceFileName;
  private disposables: vscode.Disposable[] = [];
  private isWPILibProject: boolean = false;

  constructor(workspace: vscode.WorkspaceFolder) {
    this.workspace = workspace;
    this.configFolder = path.join(workspace.uri.fsPath, '.wpilib');

    const configFilePath = path.join(this.configFolder, this.preferenceFileName);

    if (fs.existsSync(configFilePath)) {
      vscode.commands.executeCommand('setContext', 'isWPILibProject', true);
      this.isWPILibProject = true;
      this.preferencesFile = vscode.Uri.file(configFilePath);
      this.preferencesJson = defaultPreferences;
      this.updatePreferences();
    } else {
      // Set up defaults, and create
      this.preferencesJson = defaultPreferences;
    }

    const rp = new vscode.RelativePattern(workspace, this.preferencesGlob);

    this.configFileWatcher = vscode.workspace.createFileSystemWatcher(rp);
    this.disposables.push(this.configFileWatcher);

    this.configFileWatcher.onDidCreate((uri) => {
      vscode.commands.executeCommand('setContext', 'isWPILibProject', true);
      this.isWPILibProject = true;
      this.preferencesFile = uri;
      this.updatePreferences();
    });

    this.configFileWatcher.onDidDelete(() => {
      vscode.commands.executeCommand('setContext', 'isWPILibProject', false);
      this.isWPILibProject = false;
      this.preferencesFile = undefined;
      this.updatePreferences();
    });

    this.configFileWatcher.onDidChange(() => {
      this.updatePreferences();
    });

  }

  public getIsWPILibProject(): boolean {
    return this.isWPILibProject;
  }

  public async getTeamNumber(): Promise<number> {
    // If always ask, get it.
    const alwaysAsk = this.getConfiguration().get<boolean>('alwaysAskForTeamNumber');
    if (alwaysAsk !== undefined && alwaysAsk === true) {
      return requestTeamNumber();
    }
    const res = this.getConfiguration().get<number>('teamNumber');
    if (res === undefined || res < 0) {
      return this.noTeamNumberLogic();
    }
    return res;
  }

  public async setTeamNumber(teamNumber: number, global: boolean): Promise<void> {
    try {
      if (global) {
        await this.getConfiguration().update('teamNumber', teamNumber, vscode.ConfigurationTarget.Global);
      } else {
        await this.getConfiguration().update('teamNumber', teamNumber, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    } catch (err) {
      console.log('error setting team number', err);
    }
  }

  public getCurrentLanguage(): string {
    return this.preferencesJson.currentLanguage;
  }

  public async setCurrentLanguage(language: string): Promise<void> {
    this.preferencesJson.currentLanguage = language;
    await this.writePreferences();
  }

  public getAutoStartRioLog(): boolean {
    const res = this.getConfiguration().get<boolean>('autoStartRioLog');
    if (res === undefined) {
      return false;
    }
    return res;
  }

  public async setAutoStartRioLog(autoStart: boolean, global: boolean): Promise<void> {
    let target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global;
    if (!global) {
      target = vscode.ConfigurationTarget.WorkspaceFolder;
    }
    return this.getConfiguration().update('autoStartRioLog', autoStart, target);
  }

  public getAutoSaveOnDeploy(): boolean {
    const res = this.getConfiguration().get<boolean>('autoSaveOnDeploy');
    if (res === undefined) {
      return false;
    }
    return res;
  }

  public async setAutoSaveOnDeploy(autoSave: boolean, global: boolean): Promise<void> {
    let target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global;
    if (!global) {
      target = vscode.ConfigurationTarget.WorkspaceFolder;
    }
    return this.getConfiguration().update('autoSaveOnDeploy', autoSave, target);
  }

  public getOnline(): boolean {
    const res = this.getConfiguration().get<boolean>('online');
    if (res === undefined) {
      return false;
    }
    return res;
  }

  public dispose() {
    for (const d of this.disposables) {
      d.dispose();
    }
  }

  private getConfiguration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('wpilib', this.workspace.uri);
  }

  private updatePreferences() {
    if (this.preferencesFile === undefined) {
      this.preferencesJson = defaultPreferences;
      return;
    }

    const results = fs.readFileSync(this.preferencesFile.fsPath, 'utf8');
    this.preferencesJson = jsonc.parse(results) as IPreferencesJson;
  }

  private async writePreferences(): Promise<void> {
    if (this.preferencesFile === undefined) {
      const configFilePath = path.join(this.configFolder, this.preferenceFileName);
      this.preferencesFile = vscode.Uri.file(configFilePath);
      await promisifyMkDir(path.dirname(this.preferencesFile.fsPath));
    }
    await promisifyWriteFile(this.preferencesFile.fsPath, JSON.stringify(this.preferencesJson, null, 4));
  }

  private async noTeamNumberLogic(): Promise<number> {
    // Ask if user wants to set team number.
    const teamRequest = await vscode.window.showInformationMessage('No team number, would you like to save one?',
      'Yes (Globally)', 'Yes (Workspace)', 'No');
    if (teamRequest === undefined) {
      return -1;
    }
    const teamNumber = await requestTeamNumber();
    if (teamRequest === 'No') {
      return teamNumber;
    }
    if (teamNumber !== -1 && teamRequest === 'Yes (Globally)') {
      await this.setTeamNumber(teamNumber, true);
    } else if (teamNumber !== -1 && teamRequest === 'Yes (Workspace)') {
      await this.setTeamNumber(teamNumber, false);
    }
    return teamNumber;
  }
}
