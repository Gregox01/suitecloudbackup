import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as cp from 'child_process';
import { promisify } from 'util';

const exec = promisify(cp.exec);

export interface CommandResult {
  success: boolean;
  output?: string;
  error?: string;
}

export class SuiteCloudManager {
  private outputChannel: vscode.OutputChannel;
  private authId: string | undefined;
  private projectRoot: string | undefined;

  constructor(_context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Get workspace folder
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this.log('No workspace folder found');
        return;
      }

      this.projectRoot = workspaceFolders[0].uri.fsPath;

      // Try to load authId from project.json
      try {
        const projectJsonPath = path.join(this.projectRoot, 'project.json');
        if (fs.existsSync(projectJsonPath)) {
          const projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
          this.authId = projectData.defaultAuthId;
          this.log(`Found defaultAuthId: ${this.authId}`);
        }
      } catch (error) {
        this.log(`Error reading project.json: ${error instanceof Error ? error.message : String(error)}`);
      }

      // If no authId found in project.json, try to get from VS Code settings
      if (!this.authId) {
        this.authId = vscode.workspace.getConfiguration('suitecloudbackup').get('defaultAuthId');
        if (this.authId) {
          this.log(`Using defaultAuthId from settings: ${this.authId}`);
        }
      }

      // If still no authId, check if we can detect any from the suitecloud
      if (!this.authId) {
        try {
          const result = await exec('suitecloud account:manageauth', { cwd: this.projectRoot });
          if (result.stdout && result.stdout.includes('Account credentials were found')) {
            // Try to extract the auth ID
            const match = result.stdout.match(/ID: (\S+)/);
            if (match && match[1]) {
              this.authId = match[1];
              this.log(`Detected authId: ${this.authId}`);
            }
          }
        } catch (error) {
          this.log(`Error detecting authId: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!this.authId) {
        // If still no authId, prompt the user to set up authentication
        const setupNow = 'Setup Now';
        const response = await vscode.window.showWarningMessage(
          'No NetSuite authentication found. Setup authentication to use SuiteCloud Backup.',
          setupNow
        );

        if (response === setupNow) {
          vscode.commands.executeCommand('suitecloud.setupaccount');
        }
      }
    } catch (error) {
      this.log(`Initialization error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[SuiteCloudManager] ${message}`);
  }

  private async runCommand(command: string): Promise<CommandResult> {
    try {
      if (!this.projectRoot) {
        return { success: false, error: 'No project root directory found' };
      }

      this.log(`Running command: ${command}`);
      const result = await exec(command, { cwd: this.projectRoot });

      this.log(`Command output: ${result.stdout}`);
      if (result.stderr) {
        this.log(`Command stderr: ${result.stderr}`);
      }

      return { success: true, output: result.stdout };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.log(`Command error: ${errorMsg}`);

      // Extract stderr from error object if available
      const execError = error as { stderr?: string };
      return {
        success: false,
        error: errorMsg,
        output: execError.stderr
      };
    }
  }

  public async uploadFile(uri: vscode.Uri): Promise<CommandResult> {
    try {
      // Convert URI to suite cloud path
      const filePath = this.convertToSuiteCloudPath(uri.fsPath);

      if (!filePath) {
        return { success: false, error: 'Invalid file path: Not a SuiteScripts file' };
      }      // Use authId if available

      const command = `suitecloud file:upload --paths "${filePath}"`;

      return await this.runCommand(command);
    } catch (error) {
      return {
        success: false,
        error: `Upload error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  public async importFile(uri: vscode.Uri): Promise<CommandResult> {
    try {
      // Convert URI to suite cloud path
      const filePath = this.convertToSuiteCloudPath(uri.fsPath);

      if (!filePath) {
        return { success: false, error: 'Invalid file path: Not a SuiteScripts file' };
      }

      // Import command doesn't support authid parameter directly
      const command = `suitecloud file:import --paths "/${filePath}"`;

      return await this.runCommand(command);
    } catch (error) {
      return {
        success: false,
        error: `Import error: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }

  private convertToSuiteCloudPath(fsPath: string): string | null {
    try {
      if (!this.projectRoot) {
        this.log('No project root found');
        return null;
      }

      // Get the path relative to the project root
      let relativePath = path.relative(this.projectRoot, fsPath);

      // Convert Windows backslashes to forward slashes
      relativePath = relativePath.replace(/\\/g, '/');

      // Check if this is a SuiteScripts file
      if (relativePath.includes('FileCabinet/SuiteScripts')) {
        // Extract the SuiteScripts portion
        const parts = relativePath.split('FileCabinet/SuiteScripts');
        if (parts.length > 1) {
          const scriptPath = parts[1].startsWith('/') ? parts[1].substring(1) : parts[1];
          return `SuiteScripts${scriptPath ? '/' + scriptPath : ''}`;
        }
      } else if (relativePath.includes('SuiteScripts')) {
        // It might already be a direct SuiteScripts path
        const parts = relativePath.split('SuiteScripts');
        if (parts.length > 1) {
          const scriptPath = parts[1].startsWith('/') ? parts[1].substring(1) : parts[1];
          return `SuiteScripts${scriptPath ? '/' + scriptPath : ''}`;
        }
      }

      this.log(`Could not convert to SuiteCloud path: ${fsPath}`);
      return null;
    } catch (error) {
      this.log(`Path conversion error: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }
}