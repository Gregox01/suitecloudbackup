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

export interface AccountInfo {
  name: string;
  id: string;
  url: string;
}

export class SuiteCloudManager {
  private outputChannel: vscode.OutputChannel;
  private authId: string | undefined;
  private projectRoot: string | undefined;
  private accountInfo: Map<string, AccountInfo> = new Map();

  /**
   * Finds the nearest node_modules directory by traversing up the directory tree
   * @param startPath The path to start searching from
   * @returns The path to the nearest node_modules directory or null if not found
   */
  public findNearestNodeModules(startPath: string): string | null {
    try {
      let currentPath = startPath;

      while (currentPath) {
        const nodeModulesPath = path.join(currentPath, 'node_modules');
        if (fs.existsSync(nodeModulesPath)) {
          this.log(`Found node_modules at: ${nodeModulesPath}`);
          return nodeModulesPath;
        }

        // Get the parent directory
        const parentPath = path.dirname(currentPath);
        // If we've reached the root directory, stop
        if (parentPath === currentPath) {
          break;
        }
        currentPath = parentPath;
      }

      this.log(`No node_modules found in directory tree starting from: ${startPath}`);
      return null;
    } catch (error) {
      this.log(`Error searching for node_modules: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Sets up the NODE_PATH environment variable with the appropriate node_modules paths
   * @param env The environment object to modify
   * @param projectRoot The project root directory to start searching from
   * @returns The modified environment object
   */
  public setupNodePath(env: NodeJS.ProcessEnv, projectRoot: string): NodeJS.ProcessEnv {
    // First check if we have a custom path in VS Code settings
    const customPath = vscode.workspace.getConfiguration('suitecloudbackup').get<string>('customNodeModulesPath');
    if (customPath && fs.existsSync(customPath)) {
      if (!env.NODE_PATH?.includes(customPath)) {
        const delimiter = process.platform === 'win32' ? ';' : ':';
        env.NODE_PATH = customPath + (env.NODE_PATH ? delimiter + env.NODE_PATH : '');
        this.log(`Using custom Node.js modules path from settings: ${customPath}`);
      }
    } else {
      // Look for node_modules in the project directory tree
      const projectNodeModules = this.findNearestNodeModules(projectRoot);
      if (projectNodeModules && !env.NODE_PATH?.includes(projectNodeModules)) {
        const delimiter = process.platform === 'win32' ? ';' : ':';
        env.NODE_PATH = projectNodeModules + (env.NODE_PATH ? delimiter + env.NODE_PATH : '');
        this.log(`Using project node_modules: ${projectNodeModules}`);
      }
    }
    return env;
  }

  /**
   * Ensures the custom Node.js path is set correctly for your environment
   * This helps find modules in non-standard locations
   */
  private ensureCustomNodePath(): void {
    if (!this.projectRoot) {
      return;
    }

    // Set up NODE_PATH in the process environment
    process.env = this.setupNodePath(process.env, this.projectRoot);

    // Reinitialize the Node.js module resolution paths
    try {
      require('module').Module._initPaths();
      this.log('Successfully initialized custom Node.js module paths');
    } catch (error) {
      this.log(`Error initializing module paths: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  constructor(_context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;

    // Set up custom Node.js path before initializing
    this.ensureCustomNodePath();

    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      this.log('=== INITIALIZE METHOD START ===');
      // Get workspace folder
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        this.log('No workspace folder found');
        return;
      }

      this.projectRoot = workspaceFolders[0].uri.fsPath;
      this.log(`Project root set to: ${this.projectRoot}`);

      // Try to load authId and account info from project.json
      try {
        const projectJsonPath = path.join(this.projectRoot, 'project.json');
        this.log(`Looking for project.json at: ${projectJsonPath}`);

        if (fs.existsSync(projectJsonPath)) {
          this.log('project.json found, reading contents...');
          const projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
          this.log(`Project.json content: ${JSON.stringify(projectData, null, 2)}`);

          this.authId = projectData.defaultAuthId;
          this.log(`Loaded authId from project.json: ${this.authId}`);

          // Extract account information
          if (projectData.accountSpecificValues) {
            this.log('Found accountSpecificValues in project.json');
            for (const [authId, accountData] of Object.entries(projectData.accountSpecificValues)) {
              this.log(`Processing account for authId: ${authId}`);
              const accountDataTyped = accountData as any;
              const accountInfo: AccountInfo = {
                name: accountDataTyped.companyName || '',
                id: accountDataTyped.companyId || '',
                url: accountDataTyped.netSuiteUrl || ''
              };
              this.accountInfo.set(authId, accountInfo);
              this.log(`Added account info for ${authId}: ${JSON.stringify(accountInfo)}`);
            }
          } else {
            this.log('No accountSpecificValues found in project.json');
          }
        } else {
          this.log('project.json not found');
        }
      } catch (error) {
        this.log(`Error reading project.json: ${error instanceof Error ? error.message : String(error)}`);
      }

      // If no authId found in project.json, try to get from VS Code settings
      if (!this.authId) {
        this.log('No authId from project.json, checking VS Code settings');
        const config = vscode.workspace.getConfiguration('suitecloudbackup');
        this.log(`VS Code config: ${JSON.stringify(config)}`);
        this.authId = config.get('defaultAuthId');
        if (this.authId) {
          this.log(`Using authId from VS Code settings: ${this.authId}`);
        } else {
          this.log('No authId in VS Code settings');
        }
      }

      // Try to get account information from suitecloud CLI
      await this.fetchAccountInfo();

      // If still no authId, check if we can detect any from the suitecloud
      if (!this.authId) {
        try {
          const result = await exec('suitecloud account:manageauth --list', { cwd: this.projectRoot });
          if (result.stdout) {
            // Try to extract the auth ID
            const authMatches = result.stdout.match(/ID: (\S+)/g);
            if (authMatches && authMatches.length > 0) {
              // Use the first auth ID if available
              const match = authMatches[0].match(/ID: (\S+)/);
              if (match && match[1]) {
                this.authId = match[1];
                // Try to get account info for this auth ID
                await this.fetchAccountInfo();
              }
            }
          }
        } catch (error) {
          this.log(`Error detecting authId: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (!this.authId) {
        // If still no authId, prompt the user to set up authentication but don't block
        const setupNow = 'Setup Now';
        // Don't await the response, make it non-blocking
        vscode.window.showWarningMessage(
          'No NetSuite authentication found. Setup authentication to use SuiteCloud Backup.',
          setupNow
        ).then(response => {
          if (response === setupNow) {
            vscode.commands.executeCommand('suitecloud.setupaccount');
          }
        });
      }
    } catch (error) {
      this.log(`Error initializing SuiteCloudManager: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Attempts to fetch account information from SuiteCloud CLI
   */
  private async fetchAccountInfo(): Promise<void> {
    try {
      // Get the auth ID, fallback to default
      const authId = this.authId;

      // Only continue if we have a valid auth ID
      if (authId) {
        // First try to get account info with auth:list command
        const result = await exec('suitecloud account:setup --list', {
          cwd: this.projectRoot,
          timeout: 5000
        }).catch(() => ({ stdout: '', stderr: '' }));

        // Parse output for account info
        if (result.stdout) {
          const accountMatch = result.stdout.match(new RegExp(`\\[${authId}\\]\\s*ACCOUNT:\\s*\\[(.+?)\\]\\s*ROLE:\\s*\\[(.+?)\\]`, 's'));
          if (accountMatch && accountMatch[1]) {
            const name = accountMatch[1].trim();
            const id = accountMatch[2] ? accountMatch[2].trim() : '';
            this.accountInfo.set(authId, { name, id, url: '' });
          }
        }
      }

      // Try with account:manageauth command as well
      const listResult = await exec('suitecloud account:manageauth --list', {
        cwd: this.projectRoot,
        timeout: 5000
      }).catch(() => ({ stdout: '', stderr: '' }));

      if (listResult.stdout) {
        // Look for account information in output - different pattern
        const lines = listResult.stdout.split('\n');
        let currentAuthId = '';

        for (const line of lines) {
          const authIdMatch = line.match(/ID: (\S+)/);
          if (authIdMatch) {
            currentAuthId = authIdMatch[1];
            continue;
          }

          if (currentAuthId) {
            const accountNameMatch = line.match(/Account name: ([^\n]+)/);
            const accountIdMatch = line.match(/Account ID: ([^\n]+)/);
            const accountUrlMatch = line.match(/Account URL: ([^\n]+)/);

            if (accountNameMatch || accountIdMatch || accountUrlMatch) {
              // Get existing account info or create new
              const existingInfo = this.accountInfo.get(currentAuthId) || { name: '', id: '', url: '' };

              // Update with any new information
              if (accountNameMatch) {
                existingInfo.name = accountNameMatch[1].trim();
              }
              if (accountIdMatch) {
                existingInfo.id = accountIdMatch[1].trim();
              }
              if (accountUrlMatch) {
                existingInfo.url = accountUrlMatch[1].trim();
              }

              // Save updated info
              this.accountInfo.set(currentAuthId, existingInfo);
            }
          }
        }
      }
    } catch (error) {
      this.log(`Error fetching account info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Logs all discovered account information for debugging
   */
  private logAccountInfo(): void {
    this.log('All discovered account information:');
    for (const [authId, info] of this.accountInfo.entries()) {
      this.log(`- Auth ID: ${authId}`);
      if (info.name) this.log(`  - Account name: ${info.name}`);
      if (info.id) this.log(`  - Account ID: ${info.id}`);
      if (info.url) this.log(`  - URL: ${info.url}`);
    }
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[SuiteCloudManager] ${message}`);
  }

  /**
   * Runs a SuiteCloud CLI command
   * @param command The command to run
   * @returns Result of the command execution
   */
  private async runCommand(command: string): Promise<CommandResult> {
    try {
      this.log(`Running: ${command}`);

      if (!this.projectRoot) {
        return {
          success: false,
          error: 'No project root directory found'
        };
      }

      if (!this.authId) {
        return {
          success: false,
          error: 'No authentication ID available'
        };
      }

      // Verify authentication before running command
      const verifyResult = await this.verifyAuthentication();
      if (!verifyResult) {
        // Handle authentication failure specifically for the current auth ID
        vscode.window.showErrorMessage(
          `The "${this.authId}" authentication ID is not available. Would you like to set it up?`,
          `Setup "${this.authId}" Authentication`,
          'Cancel'
        ).then(selection => {
          if (selection === `Setup "${this.authId}" Authentication`) {
            vscode.commands.executeCommand('suitecloudbackup.setupSpecificAuthentication', this.authId);
          }
        });

        return {
          success: false,
          error: `The "${this.authId}" authentication ID is not available. Check your authentication credentials and try again.`
        };
      }

      // Execute the command with a proper timeout and custom environment
      try {
        // Add verbose flags for more detailed output when possible
        let verboseCommand = command;
        // Only add verbose flag for commands that support it
        if (!command.includes('file:import')) {
          verboseCommand = `${command}`;
          this.log(`Enhanced command with verbose flag: ${verboseCommand}`);
        }

        // Use child_process.exec with a promise and timeout
        const result = await new Promise<{stdout: string, stderr: string}>((resolve, reject) => {
          // Prepare environment with custom NODE_PATH
          const env = this.setupNodePath({ ...process.env }, this.projectRoot || '');

          // Execute with custom environment
          const childProcess = require('child_process').exec(
            verboseCommand,
            {
              cwd: this.projectRoot,
              env: env,
              maxBuffer: 5 * 1024 * 1024, // 5MB buffer for verbose output
              timeout: 60000 // 60 second timeout
            },
            (error: any, stdout: string, stderr: string) => {
              if (error) {
                // Capture detailed error information
                this.log(`Command error: ${error.message}`);
                this.log(`Stderr: ${stderr}`);
                this.log(`Stdout: ${stdout}`);
                reject({
                  error,
                  stdout,
                  stderr
                });
              } else {
                resolve({ stdout, stderr });
              }
            }
          );

          // Log when process exits
          childProcess.on('exit', (code: number) => {
            this.log(`Command process exited with code: ${code}`);
          });
        });

        // Process successful result
        this.log(`Command executed successfully`);
        return {
          success: true,
          output: result.stdout
        };
      } catch (execError: any) {
        const errorInfo = execError.error || execError;
        const stderr = execError.stderr || '';
        const stdout = execError.stdout || '';

        // Detailed logging of the error
        this.log(`Command execution failed with code: ${errorInfo.code || 'unknown'}`);
        this.log(`Error message: ${errorInfo.message || String(errorInfo)}`);

        if (stderr) {
          this.log(`Standard Error: ${stderr}`);
        }

        if (stdout) {
          this.log(`Standard Output: ${stdout}`);
        }

        // Special handling for import errors
        if (command.includes('file:import')) {
          return this.handleImportError(command, errorInfo, stderr, stdout);
        }

        // General error handling
        return {
          success: false,
          error: errorInfo.message || String(errorInfo)
        };
      }
    } catch (error: any) {
      this.log(`Unexpected error in runCommand: ${error instanceof Error ? error.message : String(error)}`);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Verifies authentication with the SuiteCloud CLI
   * @returns True if authentication is valid, false otherwise
   */
  private async verifyAuthentication(): Promise<boolean> {
    try {
      if (!this.authId) {
        this.log('No authentication ID available for verification');
        return false;
      }

      if (!this.projectRoot) {
        this.log('No project root available for verification');
        return false;
      }

      // Run the SuiteCloud CLI command to list authentications
      const command = `suitecloud account:manageauth --list`;
      this.log(`Verifying authentication with command: ${command}`);

      try {
        const result = await exec(command, {
          cwd: this.projectRoot,
          maxBuffer: 1024 * 1024
        });

        // Check if our auth ID is in the result
        if (result.stdout.includes(this.authId)) {
          this.log(`Authentication verified for ${this.authId}`);
          return true;
        } else {
          this.log(`Authentication ID ${this.authId} not found in available authentications`);

          // Get available auth IDs for logging
          const authIdsMatch = result.stdout.match(/authid: ([a-zA-Z0-9_-]+)/g) ||
                              result.stdout.match(/ID: ([a-zA-Z0-9_-]+)/g);

          if (authIdsMatch && authIdsMatch.length > 0) {
            const availableAuthIds = authIdsMatch.map(id => {
              if (id.startsWith('authid: ')) return id.replace('authid: ', '');
              if (id.startsWith('ID: ')) return id.replace('ID: ', '');
              return id;
            });

            this.log(`Available auth IDs: ${availableAuthIds.join(', ')}`);

            // Provide options to either set up the specific ID or choose from available ones
            vscode.window.showErrorMessage(
              `Authentication ID "${this.authId}" not found. Available IDs: ${availableAuthIds.join(', ')}`,
              `Setup "${this.authId}" Authentication`,
              'Use Available Authentication'
            ).then(selection => {
              if (selection === `Setup "${this.authId}" Authentication`) {
                // Run the specific authentication setup with the required ID
                vscode.commands.executeCommand('suitecloudbackup.setupSpecificAuthentication', this.authId);
              } else if (selection === 'Use Available Authentication') {
                // Let user select from available authentications
                vscode.window.showQuickPick(availableAuthIds, {
                  placeHolder: 'Select an available authentication ID to use',
                  ignoreFocusOut: true
                }).then(selectedAuthId => {
                  if (selectedAuthId) {
                    this.setAuthId(selectedAuthId);
                    vscode.window.showInformationMessage(`Now using authentication ID: ${selectedAuthId}`);
                  }
                });
              }
            });
          } else {
            this.log('No authentication IDs found');

            // Show notification to set up the specific authentication
            vscode.window.showErrorMessage(
              `No authentication credentials found. Need to set up "${this.authId}" authentication.`,
              `Setup "${this.authId}" Authentication`,
              'Setup Any Authentication'
            ).then(selection => {
              if (selection === `Setup "${this.authId}" Authentication`) {
                vscode.commands.executeCommand('suitecloudbackup.setupSpecificAuthentication', this.authId);
              } else if (selection === 'Setup Any Authentication') {
                vscode.commands.executeCommand('suitecloudbackup.setupAuthentication');
              }
            });
          }

          return false;
        }
      } catch (error) {
        this.log(`Error verifying authentication with CLI: ${error instanceof Error ? error.message : String(error)}`);

        // Show notification to the user with specific authentication option
        vscode.window.showErrorMessage(
          `Authentication verification failed: ${error instanceof Error ? error.message : String(error)}`,
          `Setup "${this.authId}" Authentication`,
          'Setup Any Authentication'
        ).then(selection => {
          if (selection === `Setup "${this.authId}" Authentication`) {
            vscode.commands.executeCommand('suitecloudbackup.setupSpecificAuthentication', this.authId);
          } else if (selection === 'Setup Any Authentication') {
            vscode.commands.executeCommand('suitecloudbackup.setupAuthentication');
          }
        });

        return false;
      }
    } catch (error) {
      this.log(`Authentication verification failed: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Uploads a file to NetSuite using the SuiteCloud CLI
   * @param uri The URI of the file to upload
   * @returns Result of the upload operation
   */
  public async uploadFile(uri: vscode.Uri): Promise<CommandResult> {
    this.log(`Starting file upload for: ${uri.fsPath}`);

    try {
      if (!this.projectRoot) {
        return {
          success: false,
          error: 'No project root directory found. Please open a SuiteCloud project.'
        };
      }

      if (!this.authId) {
        return {
          success: false,
          error: 'No authentication ID available. Please set up authentication first.'
        };
      }

      // Convert file path to a SuiteCloud-compatible format
      const suitecloudPath = this.convertToSuiteCloudPath(uri.fsPath);
      if (!suitecloudPath) {
        return {
          success: false,
          error: `File ${uri.fsPath} is not within the project's file cabinet directory.`
        };
      }

      this.log(`Converted to SuiteCloud path: ${suitecloudPath}`);


      // Prepare the upload command - make sure to wrap the path in quotes to handle paths with spaces
      const command = `suitecloud file:upload --paths "${suitecloudPath}"`;

      this.log(`Executing command: ${command}`);
      const result = await this.runCommand(command);

      if (result.success) {
        this.log(`File uploaded successfully: ${uri.fsPath}`);
        vscode.window.showInformationMessage(`File uploaded successfully: ${path.basename(uri.fsPath)}`);
      } else {
        this.log(`File upload failed: ${result.error}`);
        vscode.window.showErrorMessage(`Failed to upload file: ${result.error}`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`Error in uploadFile: ${errorMessage}`);
      return {
        success: false,
        error: `Failed to upload file: ${errorMessage}`
      };
    }
  }

  /**
   * Imports a file from NetSuite using the SuiteCloud CLI
   * @param uri The URI of the file to import
   * @returns Result of the import operation
   */
  public async importFile(uri: vscode.Uri): Promise<CommandResult> {
    this.log(`Starting file import for: ${uri.fsPath}`);

    try {
      if (!this.projectRoot) {
        return {
          success: false,
          error: 'No project root directory found. Please open a SuiteCloud project.'
        };
      }

      if (!this.authId) {
        return {
          success: false,
          error: 'No authentication ID available. Please set up authentication first.'
        };
      }

      // Convert file path to a SuiteCloud-compatible format
      const suitecloudPath = this.convertToSuiteCloudPath(uri.fsPath);
      if (!suitecloudPath) {
        return {
          success: false,
          error: `File ${uri.fsPath} is not within the project's file cabinet directory.`
        };
      }

      this.log(`Converted to SuiteCloud path: ${suitecloudPath}`);

      // Ask for confirmation before importing
      const answer = await vscode.window.showQuickPick(['Yes', 'No'], {
        placeHolder: `Do you want to backup ${path.basename(uri.fsPath)} from NetSuite and upload to the file cabinet the local file?`,
        canPickMany: false
      });

      if (answer !== 'Yes') {
        this.log('Import operation canceled by user');
        return {
          success: false,
          error: 'Operation canceled'
        };
      }

      // Prepare the import command - make sure to wrap the path in quotes to handle paths with spaces
      const command = `suitecloud file:import --paths "${suitecloudPath}"`;

      this.log(`Executing command: ${command}`);
      const result = await this.runCommand(command);

      if (result.success) {
        this.log(`File imported successfully: ${uri.fsPath}`);
        vscode.window.showInformationMessage(`File imported successfully: ${path.basename(uri.fsPath)}`);
      } else {
        this.log(`File import failed: ${result.error}`);
        vscode.window.showErrorMessage(`Failed to import file: ${result.error}`);
      }

      return result;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`Error in importFile: ${errorMessage}`);
      return {
        success: false,
        error: `Failed to import file: ${errorMessage}`
      };
    }
  }

  /**
   * Converts a filesystem path to a SuiteCloud-compatible path
   * @param fsPath The filesystem path to convert
   * @returns The SuiteCloud-compatible path or null if not within the file cabinet
   */
  private convertToSuiteCloudPath(fsPath: string): string | null {
    try {
      if (!this.projectRoot) {
        this.log('No project root found');
        return null;
      }

      this.log(`Converting path: ${fsPath}`);
      this.log(`Project root: ${this.projectRoot}`);

      // Get the path relative to the project root
      let relativePath = path.relative(this.projectRoot, fsPath);
      this.log(`Relative path: ${relativePath}`);

      // Convert Windows backslashes to forward slashes
      relativePath = relativePath.replace(/\\/g, '/');
      this.log(`Normalized path: ${relativePath}`);

      // Look for FileCabinet directory patterns
      const fileCabinetPatterns = [
        { pattern: 'src/FileCabinet/', replacement: '' },
        { pattern: 'FileCabinet/', replacement: '' }
      ];

      let result: string | null = null;

      for (const { pattern, replacement } of fileCabinetPatterns) {
        if (relativePath.startsWith(pattern)) {
          result = relativePath.replace(pattern, replacement);
          this.log(`Path after removing FileCabinet prefix: ${result}`);
          break;
        }
      }

      // Check if the path is within a directory that has FileCabinet in it
      if (!result && relativePath.includes('/FileCabinet/')) {
        const parts = relativePath.split('/FileCabinet/');
        if (parts.length > 1) {
          result = parts[1];
          this.log(`Extracted path after FileCabinet: ${result}`);
        }
      }

      // If we don't have a result yet, try to use the path as is
      if (!result) {
        // Just use relative path if it seems like a valid path
        if (!relativePath.startsWith('.') && !path.isAbsolute(relativePath)) {
          result = relativePath;
          this.log(`Using normalized path as fallback: ${result}`);
        } else {
          this.log(`Could not convert path to SuiteCloud format: ${fsPath}`);
          return null;
        }
      }

      // Add leading slash for SuiteScripts paths
      if (result.includes('SuiteScripts')) {
        // If it starts with SuiteScripts, add a slash
        if (result.startsWith('SuiteScripts/') && !result.startsWith('/SuiteScripts/')) {
          result = '/' + result;
          this.log(`Added leading slash to SuiteScripts path: ${result}`);
        }
        // If it has SuiteScripts somewhere in the path but not at the start
        else if (!result.startsWith('/')) {
          const parts = result.split('SuiteScripts/');
          if (parts.length > 1 && parts[0] !== '') {
            // Only add slash if SuiteScripts is not already at the root
            result = '/' + result;
            this.log(`Added leading slash to path with SuiteScripts: ${result}`);
          }
        }
      }

      this.log(`Final SuiteCloud path: ${result}`);
      return result;
    } catch (error) {
      this.log(`Error in convertToSuiteCloudPath: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  /**
   * Refreshes account information by querying the SuiteCloud CLI
   * @returns A promise that resolves when the refresh is complete
   */
  public async refreshAccountInfo(): Promise<void> {
    this.log('Manually refreshing account information...');
    try {
      await this.fetchAccountInfo();
      this.logAccountInfo();
      this.log('Account information refresh completed successfully');
    } catch (error) {
      this.log(`Account information refresh failed: ${error instanceof Error ? error.message : String(error)}`);
      this.log(`Error stack: ${error instanceof Error && error.stack ? error.stack : 'No stack trace available'}`);
      throw error; // Re-throw to let callers handle the error
    }
  }

  /**
   * Gets account information for the specified authentication ID
   * @param authId The authentication ID (if not provided, uses the default)
   * @returns Account information or undefined if not found
   */
  public getAccountInfo(authId?: string): AccountInfo | undefined {
    const id = authId || this.authId;
    if (!id) return undefined;

    return this.accountInfo.get(id);
  }

  /**
   * Gets the current authentication ID
   * @returns The current authentication ID or undefined if not set
   */
  public getAuthId(): string | undefined {
    return this.authId;
  }

  /**
   * Gets all available account information
   * @returns Map of auth IDs to account information
   */
  public getAllAccountInfo(): Map<string, AccountInfo> {
    return new Map(this.accountInfo);
  }

  /**
   * Gets the project root directory
   */
  public getProjectRoot(): string | undefined {
    return this.projectRoot;
  }

  /**
   * Sets the authentication ID to use for SuiteCloud operations
   * @param authId The authentication ID to use
   */
  public setAuthId(authId: string): void {
    this.log(`Setting authentication ID to: ${authId}`);
    if (this.authId !== authId) {
      this.authId = authId;
    }
  }

  /**
   * Handles errors from the file:import command with more context
   * @param command The original command
   * @param error The error object
   * @param stderr Standard error output
   * @param stdout Standard output
   * @returns Formatted command result with helpful error information
   */
  private handleImportError(command: string, error: any, stderr: string, stdout: string): CommandResult {
    // Extract the file path from the command
    const pathMatch = command.match(/--paths\s+"([^"]+)"/);
    const filePath = pathMatch ? pathMatch[1] : 'unknown file';

    this.log(`Analyzing import error for file: ${filePath}`);
    this.log(`Error code: ${error.code || 'none'}`);

    // Log the command for debugging purposes
    this.log(`Full command that failed: ${command}`);

    // NetSuite-specific file not found errors
    const notFoundIndicators = [
      'not found', 'could not be found', 'does not exist',
      'No such file', '404', 'not available'
    ];

    for (const indicator of notFoundIndicators) {
      if (stderr.includes(indicator) || stdout.includes(indicator)) {
        this.log(`Detected 'not found' error with indicator: ${indicator}`);
        return {
          success: false,
          error: `File not found in NetSuite: ${filePath}. The file may not exist in the FileCabinet or the path may be incorrect.`
        };
      }
    }

    // Permission errors
    const permissionIndicators = [
      'permission', 'access denied', 'not authorized',
      'insufficient privileges', 'authorization', 'forbidden', '403'
    ];

    for (const indicator of permissionIndicators) {
      if (stderr.includes(indicator) || stdout.includes(indicator)) {
        this.log(`Detected permission error with indicator: ${indicator}`);
        return {
          success: false,
          error: `Permission denied accessing ${filePath}. Check your NetSuite role permissions or authentication.`
        };
      }
    }

    // Network and timeout errors
    if (stderr.includes('timeout') || stdout.includes('timeout') ||
        error.message?.includes('timeout') || error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      this.log(`Detected network/timeout error with code: ${error.code}`);
      return {
        success: false,
        error: `Connection issue while importing ${filePath}. Check your network connection and try again.`
      };
    }

    // Path errors - NetSuite may reject certain path formats
    if (stderr.includes('path') || stdout.includes('path') ||
        stderr.includes('invalid file') || stdout.includes('invalid file')) {
      this.log(`Detected path format error`);
      // Suggest path format corrections
      return {
        success: false,
        error: `Invalid file path format: ${filePath}. Try adjusting the path format - ensure proper slashes and check if the path should start with '/'.`
      };
    }

    // General NetSuite errors
    if (stderr.includes('NetSuite') || stdout.includes('NetSuite')) {
      // Try to extract a more specific error message
      const netsuiteErrorMatch = stderr.match(/NetSuite\s+error:?\s+([^\n]+)/) ||
                               stdout.match(/NetSuite\s+error:?\s+([^\n]+)/);
      if (netsuiteErrorMatch) {
        this.log(`Extracted NetSuite error message: ${netsuiteErrorMatch[1]}`);
        return {
          success: false,
          error: `NetSuite error: ${netsuiteErrorMatch[1]}`
        };
      }
    }

    // If no specific error pattern matched, provide a clearer error message than the default
    // Also show the error command for manual troubleshooting
    this.log(`No specific error pattern matched, providing generic error message`);
    return {
      success: false,
      error: `Failed to import ${filePath}. Try running the command manually in a terminal for more details: ${command}`
    };
  }
}