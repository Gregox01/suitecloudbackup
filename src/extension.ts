import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { BackupManager } from './backupManager';
import { SuiteCloudManager } from './suiteCloudManager';
import { BackupExplorer } from './backupExplorer';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

// Promisify exec to use with async/await
const exec = promisify(execCallback);

/**
 * Checks if the credentials directory exists and contains valid credential files
 * @param outputChannel The output channel to log messages to
 * @returns True if credentials directory exists and has valid credential files
 */
async function checkCredentialsDirectory(outputChannel: vscode.OutputChannel): Promise<boolean> {
  try {
    // Path to the .suitecloud-sdk directory
    const homedir = require('os').homedir();
    const suiteCloudSdkDir = path.join(homedir, '.suitecloud-sdk');

    outputChannel.appendLine(`[Auth Check] Checking SuiteCloud SDK directory: ${suiteCloudSdkDir}`);

    // Check if the directory exists
    try {
      await fs.promises.access(suiteCloudSdkDir, fs.constants.R_OK | fs.constants.W_OK);
      outputChannel.appendLine('[Auth Check] SuiteCloud SDK directory exists and is accessible');
    } catch (error) {
      outputChannel.appendLine(`[Auth Check] SuiteCloud SDK directory issue: ${error instanceof Error ? error.message : String(error)}`);

      // Create the directory if it doesn't exist
      try {
        await fs.promises.mkdir(suiteCloudSdkDir, { recursive: true });
        outputChannel.appendLine('[Auth Check] Created .suitecloud-sdk directory');
      } catch (mkdirError) {
        outputChannel.appendLine(`[Auth Check] Failed to create .suitecloud-sdk directory: ${mkdirError instanceof Error ? mkdirError.message : String(mkdirError)}`);
        return false;
      }
    }

    // Check for credential files (multiple possibilities based on SDK version)
    const credentialsFiles = [
      path.join(suiteCloudSdkDir, 'credentials'),                   // Earlier versions
      path.join(suiteCloudSdkDir, 'credentials_browser_based.p12'), // 2025.1+ browser-based
      path.join(suiteCloudSdkDir, 'credentials_ci.p12')             // 2025.1+ machine-to-machine
    ];

    let credentialsFound = false;
    for (const credentialsPath of credentialsFiles) {
      try {
        await fs.promises.access(credentialsPath, fs.constants.R_OK);
        outputChannel.appendLine(`[Auth Check] Found credentials file: ${path.basename(credentialsPath)}`);
        credentialsFound = true;
      } catch (error) {
        // This particular credentials file doesn't exist, which is okay if we find at least one
      }
    }

    if (!credentialsFound) {
      outputChannel.appendLine('[Auth Check] No credentials files found. Authentication setup will be required.');
      return false;
    }

    // If we got here, at least one credentials file exists
    outputChannel.appendLine('[Auth Check] Credentials found. Relying on SuiteCloud CLI to validate specific auth IDs.');
    return true;
  } catch (error) {
    outputChannel.appendLine(`[Auth Check] Error checking credentials directory: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Verifies the authentication with NetSuite using SuiteCloud CLI
 * @param authId The authentication ID to verify
 * @param projectRoot The root directory of the project
 * @param outputChannel The output channel to log messages to
 * @returns True if authentication is valid, false otherwise
 */
async function verifyAuthentication(authId: string | undefined, projectRoot: string | undefined, outputChannel: vscode.OutputChannel): Promise<boolean> {
  outputChannel.appendLine('===== VERIFY AUTHENTICATION METHOD CALLED =====');
  try {
    outputChannel.appendLine(`Verifying authentication for ID: ${authId || 'unknown'}`);

    if (!projectRoot) {
      outputChannel.appendLine('Cannot verify authentication: No project root directory found');
      return false;
    }

    if (!authId) {
      outputChannel.appendLine('Cannot verify authentication: No authentication ID available');
      return false;
    }

    // Run the CLI command to list all available authentications
    const command = `suitecloud account:manageauth --list`;
    outputChannel.appendLine(`Running auth validation command: ${command}`);

    try {
      // Add a proper timeout to prevent getting stuck
      const timeoutPromise = new Promise<{stdout: string, stderr: string}>((_, reject) => {
        setTimeout(() => reject(new Error('Authentication verification timed out after 20 seconds')), 20000);
      });

      const execPromise = exec(command, {
        cwd: projectRoot,
        maxBuffer: 1024 * 1024
      });

      // Race the execution against the timeout
      const result = await Promise.race([execPromise, timeoutPromise]);

      outputChannel.appendLine(`Auth validation command executed successfully`);

      // Check if the output includes our auth ID
      if (result.stdout.includes(authId)) {
        outputChannel.appendLine(`Authentication verified successfully for ${authId}`);
        return true;
      } else {
        outputChannel.appendLine(`Authentication ID ${authId} not found in available authentications`);

        // Extract all available auth IDs for diagnostics
        const authIdsMatch = result.stdout.match(/authid: ([a-zA-Z0-9_-]+)/g) ||
                            result.stdout.match(/ID: ([a-zA-Z0-9_-]+)/g);

        if (authIdsMatch && authIdsMatch.length > 0) {
          const availableAuthIds = authIdsMatch.map(id => {
            if (id.startsWith('authid: ')) return id.replace('authid: ', '');
            if (id.startsWith('ID: ')) return id.replace('ID: ', '');
            return id;
          });

          outputChannel.appendLine(`Available auth IDs: ${availableAuthIds.join(', ')}`);

          // Show notification with available auth IDs
          vscode.window.showErrorMessage(
            `Authentication ID "${authId}" not found. Available IDs: ${availableAuthIds.join(', ')}`,
            'Setup Authentication'
          ).then(selection => {
            if (selection === 'Setup Authentication') {
              const terminal = vscode.window.createTerminal('NetSuite Authentication');
              terminal.show();
              terminal.sendText('suitecloud account:setup');
            }
          });
        } else {
          // No auth IDs found
          outputChannel.appendLine('No authentication IDs found in CLI output');

          vscode.window.showErrorMessage(
            'No authentication credentials found. Please set up authentication.',
            'Setup Authentication'
          ).then(selection => {
            if (selection === 'Setup Authentication') {
              const terminal = vscode.window.createTerminal('NetSuite Authentication');
              terminal.show();
              terminal.sendText('suitecloud account:setup');
            }
          });
        }
        return false;
      }
    } catch (error) {
      outputChannel.appendLine(`Error running auth validation command: ${error instanceof Error ? error.message : String(error)}`);

      // Show error message to user
      vscode.window.showErrorMessage(
        `Authentication verification failed: ${error instanceof Error ? error.message : String(error)}`,
        'Setup Authentication'
      ).then(selection => {
        if (selection === 'Setup Authentication') {
          const terminal = vscode.window.createTerminal('NetSuite Authentication');
          terminal.show();
          terminal.sendText('suitecloud account:setup');
        }
      });
      return false;
    }
  } catch (error) {
    outputChannel.appendLine(`Authentication verification failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}


async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

/**
 * Sets up authentication for SuiteCloud SDK
 * This will open a terminal and run the suitecloud account:setup command
 */
async function setupAuthentication() {
  // Ask user which type of authentication they want to set up
  const authType = await vscode.window.showQuickPick(
    [
      {
        label: 'Browser-Based Authentication',
        description: 'Interactive login using NetSuite account credentials (Recommended)',
        detail: 'Credentials stored in credentials_browser_based.p12 with auto-generated passkey'
      },
      {
        label: 'Machine-to-Machine Authentication',
        description: 'CLI-based authentication for CI/CD environments',
        detail: 'Credentials stored in credentials_ci.p12 with SUITECLOUD_CI_PASSKEY environment variable'
      }
    ],
    {
      placeHolder: 'Select authentication method',
      ignoreFocusOut: true
    }
  );

  if (!authType) {
    return; // User cancelled
  }

  // Create a terminal for the user to run the setup command
  const terminal = vscode.window.createTerminal('NetSuite Authentication Setup');
  terminal.show();

  // Show helpful instructions first
  terminal.sendText('echo "Setting up NetSuite authentication..."');
  terminal.sendText('echo "You will be prompted to provide your NetSuite account credentials."');

  if (authType.label === 'Browser-Based Authentication') {
    terminal.sendText('echo "Browser-based authentication selected:"');
    terminal.sendText('echo "1. You will be redirected to a browser window to log in to NetSuite"');
    terminal.sendText('echo "2. After successful login, return to this terminal"');
    terminal.sendText('echo "3. When prompted, provide a name for this authentication (e.g., your project name)"');
    terminal.sendText('echo ""');

    // Run the setup command
    terminal.sendText('suitecloud account:setup');
  } else {
    terminal.sendText('echo "Machine-to-Machine authentication selected:"');
    terminal.sendText('echo "1. You will need your NetSuite Account ID and Token ID/Secret"');
    terminal.sendText('echo "2. Set the SUITECLOUD_CI_PASSKEY environment variable with a secure passphrase"');
    terminal.sendText('echo "   On Windows: $env:SUITECLOUD_CI_PASSKEY = \'your-secure-passphrase\'"');
    terminal.sendText('echo "3. When prompted, provide a name for this authentication (e.g., your project name)"');
    terminal.sendText('echo ""');

    // Prompt to set the passkey first
    terminal.sendText('echo "Enter a secure passphrase for your credentials:"');
    terminal.sendText('$env:SUITECLOUD_CI_PASSKEY = Read-Host -AsSecureString | ConvertFrom-SecureString -AsPlainText');
    terminal.sendText('echo "SUITECLOUD_CI_PASSKEY environment variable set"');
    terminal.sendText('echo ""');

    // Run the setup command for CI authentication
    terminal.sendText('suitecloud account:savetoken');
  }
}

/**
 * Sets up authentication for SuiteCloud SDK with a specific authentication ID
 * This is helpful when you need to match an existing project configuration
 * @param specificAuthId The authentication ID to create
 */
async function setupSpecificAuthentication(specificAuthId?: string, context?: vscode.ExtensionContext, outputChannel?: vscode.OutputChannel) {
  const terminal = vscode.window.createTerminal(`NetSuite Auth Setup: ${specificAuthId || 'Custom'}`);
  terminal.show();

  terminal.sendText(`echo "Setting up NetSuite authentication with ID: ${specificAuthId || 'Custom'}"`);
  terminal.sendText('echo "IMPORTANT: When prompted for authentication ID, enter EXACTLY this value"');
  terminal.sendText('echo ""');

  // Get the workspace folder for project root
  const workspaceFolders = vscode.workspace.workspaceFolders;
  if (!workspaceFolders || workspaceFolders.length === 0) {
    terminal.sendText('echo "WARNING: No workspace folder found"');
    terminal.sendText('echo "You may need to set NODE_PATH manually if module resolution fails"');
    terminal.sendText('echo ""');
  } else if (context && outputChannel) {
    const projectRoot = workspaceFolders[0].uri.fsPath;
    const suiteCloudManager = new SuiteCloudManager(context, outputChannel);
    const nodeModulesPath = suiteCloudManager.findNearestNodeModules(projectRoot);

    if (nodeModulesPath) {
      terminal.sendText(`$env:NODE_PATH = "${nodeModulesPath}"`);
      terminal.sendText('echo "Set NODE_PATH environment variable to project node_modules location"');
      terminal.sendText('echo ""');
    } else {
      terminal.sendText('echo "WARNING: Could not find node_modules in project directory tree"');
      terminal.sendText('echo "You may need to set NODE_PATH manually if module resolution fails"');
      terminal.sendText('echo ""');
    }
  } else {
    terminal.sendText('echo "WARNING: Missing required context or output channel"');
    terminal.sendText('echo "You may need to set NODE_PATH manually if module resolution fails"');
    terminal.sendText('echo ""');
  }

  // Run the authentication setup command
  terminal.sendText('suitecloud account:setup');
}

export function activate(context: vscode.ExtensionContext) {
  // Initialize the output channel for logs
  const outputChannel = vscode.window.createOutputChannel('SuiteCloud Backup');
  outputChannel.show(true); // Show the output channel immediately
  outputChannel.appendLine('SuiteCloud Backup extension activated');

  try {
    // Initialize managers
    const backupManager = new BackupManager(context, outputChannel);
    const suiteCloudManager = new SuiteCloudManager(context, outputChannel);

    // Add a check for credentials early in the initialization
    checkCredentialsDirectory(outputChannel).then(result => {
      if (!result) {
        outputChannel.appendLine('Credential directory check failed - will prompt for setup later');
      }
    });

    // Connect managers
    backupManager.setSuiteCloudManager(suiteCloudManager);

    // Initialize explorer
    const backupExplorer = new BackupExplorer(context, backupManager);

    // Set up filesystem watcher for backup directory
    outputChannel.appendLine('Setting up filesystem watcher...');
    const backupDir = vscode.workspace.getConfiguration('suitecloudbackup').get<string>('backupDirectory');
    outputChannel.appendLine(`Backup directory from settings: ${backupDir || 'not set'}`);

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      outputChannel.appendLine('WARNING: No workspace folders found for watcher setup');
    }

    let backupDirPath = '';

    if (workspaceFolders && workspaceFolders.length > 0) {
      backupDirPath = path.isAbsolute(backupDir || '')
        ? backupDir || ''
        : path.join(workspaceFolders[0].uri.fsPath, backupDir || 'backups');
      outputChannel.appendLine(`Resolved backup directory path: ${backupDirPath}`);
    } else {
      outputChannel.appendLine('WARNING: Cannot resolve backup directory path without workspace folder');
    }

    if (backupDirPath) {
      try {
        outputChannel.appendLine(`Creating file system watcher for pattern: ${path.join(backupDirPath, '**/*.bak')}`);
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(backupDirPath, '**/*.bak')
        );

        // Refresh explorer on backup file changes
        watcher.onDidCreate((uri) => {
          outputChannel.appendLine(`Backup file created: ${uri.fsPath}`);
          backupExplorer.refresh();
        });

        watcher.onDidChange((uri) => {
          outputChannel.appendLine(`Backup file changed: ${uri.fsPath}`);
          backupExplorer.refresh();
        });

        watcher.onDidDelete((uri) => {
          outputChannel.appendLine(`Backup file deleted: ${uri.fsPath}`);
          backupExplorer.refresh();
        });

        context.subscriptions.push(watcher);
        outputChannel.appendLine(`Watching for changes in backup directory: ${backupDirPath}`);
      } catch (error) {
        outputChannel.appendLine(`ERROR setting up file watcher: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          outputChannel.appendLine(`Error stack: ${error.stack}`);
        }
      }
    } else {
      outputChannel.appendLine('WARNING: No backup directory path for file watcher');
    }

    // Register the upload file command
    outputChannel.appendLine('Registering commands...');

    // Register the upload file command
    const uploadFileCommand = vscode.commands.registerCommand('suitecloudbackup.uploadFile', async (uri?: vscode.Uri) => {
      try {
        outputChannel.appendLine('=== Command: suitecloudbackup.uploadFile ===');
        outputChannel.appendLine('DEBUG PATH: Starting uploadFile command flow');

        // Ensure we have a valid URI
        if (!uri || !(uri instanceof vscode.Uri)) {
          outputChannel.appendLine('Invalid URI provided');
          vscode.window.showErrorMessage('Invalid file URI provided');
          outputChannel.appendLine('=== Command: suitecloudbackup.uploadFile (End) ===');
          return;
        }

        // Log the URI that we're going to process
        outputChannel.appendLine(`URI provided: ${uri.fsPath}`);

        // Ensure the file exists
        if (!(await fileExists(uri.fsPath))) {
          outputChannel.appendLine(`File does not exist: ${uri.fsPath}`);
          vscode.window.showErrorMessage(`File not found: ${uri.fsPath}`);
          outputChannel.appendLine('=== Command: suitecloudbackup.uploadFile (End) ===');
          return;
        }

        outputChannel.appendLine(`File exists: ${uri.fsPath}`);

        // Check authentication before continuing
        outputChannel.appendLine('Checking authentication credentials...');
        await checkCredentialsDirectory(outputChannel);

        // Continue with file processing
        outputChannel.appendLine(`Starting processing for file: ${uri.fsPath}`);

        // Use withProgress to show a progress indicator during the upload
        await vscode.window.withProgress({
          location: vscode.ProgressLocation.Notification,
          title: `Uploading ${path.basename(uri.fsPath)} to NetSuite`,
          cancellable: false
        }, async (progress) => {
          // Track start time for processing
          const startTime = Date.now();
          let backupPath: string | undefined;
          let accountBackupPath: string | undefined;

          try {
            // Add debug logging before backup creation
            outputChannel.appendLine('DEBUG: About to create local backup...');

            // Step 1: Create local backup
            progress.report({ message: 'Creating local backup...', increment: 20 });
            outputChannel.appendLine('Step 1: Creating local backup...');

            try {
              backupPath = await backupManager.createBackup(uri, 'local');
              outputChannel.appendLine('DEBUG: Backup creation completed successfully.');
            } catch (backupError) {
              outputChannel.appendLine(`DEBUG: Error in backup creation: ${backupError instanceof Error ? backupError.message : String(backupError)}`);
              throw backupError;
            }

            if (!backupPath) {
              outputChannel.appendLine('DEBUG: backupPath is undefined or empty');
              throw new Error('Failed to create local backup');
            }
            outputChannel.appendLine(`Local backup created: ${backupPath}`);
            outputChannel.appendLine('DEBUG: About to start NetSuite import step...');

            // Decision branch logging
            outputChannel.appendLine('DEBUG FLOW: Decision point - should import or skip to upload');

            // Step 2: Import the current NetSuite version
            progress.report({ message: 'Importing from NetSuite...', increment: 20 });
            outputChannel.appendLine('Step 2: Importing from NetSuite...');
            const importResult = await suiteCloudManager.importFile(uri);
            outputChannel.appendLine(`DEBUG FLOW: Import call returned, success=${importResult.success}, error=${importResult.error || 'none'}`);

            if (!importResult.success) {
              const error = `Import failed: ${importResult.error || 'Unknown error'}`;
              outputChannel.appendLine(`ERROR: ${error}`);

              // Check for file not found in NetSuite error
              if (importResult.error?.includes('does not exist in NetSuite') ||
                  importResult.error?.includes('No files were found')) {

                  outputChannel.appendLine('File not found in NetSuite - this is often normal for new files');
                  outputChannel.appendLine('Skipping import and continuing with upload...');

                  // Skip to upload step for new files
                  progress.report({ message: 'Uploading to NetSuite...', increment: 40 });
                  outputChannel.appendLine('Step 5: Uploading to NetSuite...');

                  // Add debug logging for path handling
                  outputChannel.appendLine(`File absolute path: ${uri.fsPath}`);
                  outputChannel.appendLine(`Project root: ${suiteCloudManager.getProjectRoot() || 'unknown'}`);

                  // Perform the upload
                  const uploadResult = await suiteCloudManager.uploadFile(uri);

                  if (!uploadResult.success) {
                    throw new Error(uploadResult.error || 'Unknown error during upload');
                  } else {
                    outputChannel.appendLine('File uploaded successfully');
                    vscode.window.showInformationMessage(`File uploaded to NetSuite successfully: ${path.basename(uri.fsPath)}`);

                    // Show completion time
                    const endTime = Date.now();
                    const processingTime = ((endTime - startTime) / 1000).toFixed(2);
                    outputChannel.appendLine(`Processing completed in ${processingTime} seconds`);
                    return;
                  }
              }

              // Check for authentication errors
              if (importResult.error?.includes('authentication') ||
                  importResult.error?.includes('auth') ||
                  importResult.error?.includes('credentials')) {

                // Authentication error handling
                outputChannel.appendLine('Authentication issue detected. Prompting user for action.');

                const runAuth = 'Run Authentication Setup';
                const showDocs = 'View Documentation';
                const response = await vscode.window.showErrorMessage(
                  `Authentication error: "${suiteCloudManager.getAuthId()}" is not available. Would you like to set up authentication now?`,
                  runAuth,
                  showDocs
                );

                if (response === runAuth) {
                  outputChannel.appendLine('User selected to run authentication setup');

                  // Try to run the SuiteCloud extension's authentication setup
                  try {
                    await vscode.commands.executeCommand('suitecloud.setupaccount');
                    outputChannel.appendLine('Authentication setup completed');

                    // Wait a moment for the authentication to be processed
                    await new Promise(r => setTimeout(r, 1000));

                    // Retry the upload
                    outputChannel.appendLine('Retrying upload after authentication');
                    progress.report({ message: 'Retrying upload...', increment: 0 });

                    // Force refresh account info
                    await suiteCloudManager.refreshAccountInfo();

                    // Try upload again
                    const retryResult = await suiteCloudManager.uploadFile(uri);
                    if (retryResult.success) {
                      outputChannel.appendLine('Retry succeeded! File uploaded successfully.');
                      vscode.window.showInformationMessage(`File uploaded to NetSuite successfully: ${path.basename(uri.fsPath)}`);
                    } else {
                      outputChannel.appendLine(`Retry failed: ${retryResult.error}`);
                      vscode.window.showErrorMessage(`Upload failed after authentication: ${retryResult.error}`);
                    }
                  } catch (setupErr) {
                    outputChannel.appendLine(`Error running authentication setup: ${setupErr}`);

                    // Fallback to manual terminal
                    const terminal = vscode.window.createTerminal('NetSuite Authentication');
                    terminal.show();
                    if (suiteCloudManager.getProjectRoot()) {
                      terminal.sendText(`cd "${suiteCloudManager.getProjectRoot()}"`);
                    }
                    terminal.sendText('suitecloud account:setup');

                    vscode.window.showInformationMessage(
                      'Please complete the authentication process in the terminal and try uploading again.'
                    );
                  }
                } else if (response === showDocs) {
                  vscode.env.openExternal(vscode.Uri.parse('https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1558708800.html'));
                }

                // Since we've handled the auth error explicitly, we'll return early
                return;
              }

              throw new Error(importResult.error || 'Unknown error');
            } else {
              outputChannel.appendLine('NetSuite version successfully imported');

              // Step 3: Create account backup from the imported NetSuite version
              progress.report({ message: 'Creating account backup...', increment: 20 });
              outputChannel.appendLine('Step 3: Creating account backup...');
              accountBackupPath = await backupManager.createBackup(uri, 'account');
              if (!accountBackupPath) {
                throw new Error('Failed to create account backup');
              }
              outputChannel.appendLine(`Account backup created: ${accountBackupPath}`);

              // Step 4: Restore local version (since import overwrote it with NetSuite version)
              progress.report({ message: 'Restoring local version...', increment: 20 });
              outputChannel.appendLine('Step 4: Restoring local version...');

              // Make sure the backup file exists before trying to restore
              if (!fs.existsSync(backupPath)) {
                throw new Error(`Local backup file not found: ${backupPath}`);
              }

              outputChannel.appendLine(`Starting restore from ${backupPath} to ${uri.fsPath}`);
              await backupManager.restoreFile(uri, backupPath);
              outputChannel.appendLine('Local version restored successfully');
            }

            // Step 5: Upload file to NetSuite
            progress.report({ message: 'Uploading to NetSuite...', increment: 20 });
            outputChannel.appendLine('Step 5: Uploading to NetSuite...');

            // Add debug logging for path handling
            outputChannel.appendLine(`File absolute path: ${uri.fsPath}`);
            outputChannel.appendLine(`Project root: ${suiteCloudManager.getProjectRoot() || 'unknown'}`);

            // Perform the upload
            const uploadResult = await suiteCloudManager.uploadFile(uri);

            if (!uploadResult.success) {
              progress.report({ message: 'Upload failed, checking why...', increment: 0 });
              outputChannel.appendLine(`ERROR: ${uploadResult.error}`);

              // Handle authentication issues
              if (uploadResult.error?.includes('authentication ID is not available') ||
                  uploadResult.error?.includes('auth') ||
                  uploadResult.error?.includes('credentials') ||
                  uploadResult.error?.includes('token expired') ||
                  uploadResult.error?.includes('token invalid') ||
                  uploadResult.error?.includes('not authenticated')) {

                outputChannel.appendLine('Authentication issue detected. Prompting user for action.');

                const runAuth = 'Run Authentication Setup';
                const showDocs = 'View Documentation';
                const authId = suiteCloudManager.getAuthId();
                const response = await vscode.window.showErrorMessage(
                  `Authentication error: ${authId ? `"${authId}"` : 'No authentication ID'} is not available. Would you like to set up authentication now?`,
                  runAuth,
                  showDocs
                );

                if (response === runAuth) {
                  outputChannel.appendLine('User selected to run authentication setup');

                  // Try to run the SuiteCloud extension's authentication setup
                  try {
                    await vscode.commands.executeCommand('suitecloud.setupaccount');
                    outputChannel.appendLine('Authentication setup completed');

                    // Wait a moment for the authentication to be processed
                    await new Promise(r => setTimeout(r, 1000));

                    // Retry the upload
                    outputChannel.appendLine('Retrying upload after authentication');
                    progress.report({ message: 'Retrying upload...', increment: 0 });

                    // Force refresh account info
                    await suiteCloudManager.refreshAccountInfo();

                    // Try upload again
                    const retryResult = await suiteCloudManager.uploadFile(uri);
                    if (retryResult.success) {
                      outputChannel.appendLine('Retry succeeded! File uploaded successfully.');
                      vscode.window.showInformationMessage(`File uploaded to NetSuite successfully: ${path.basename(uri.fsPath)}`);
                    } else {
                      outputChannel.appendLine(`Retry failed: ${retryResult.error}`);
                      vscode.window.showErrorMessage(`Upload failed after authentication: ${retryResult.error}`);
                    }
                  } catch (setupErr) {
                    outputChannel.appendLine(`Error running authentication setup: ${setupErr}`);

                    // Fallback to manual terminal
                    const terminal = vscode.window.createTerminal('NetSuite Authentication');
                    terminal.show();
                    if (suiteCloudManager.getProjectRoot()) {
                      terminal.sendText(`cd "${suiteCloudManager.getProjectRoot()}"`);
                    }
                    terminal.sendText('suitecloud account:setup');

                    vscode.window.showInformationMessage(
                      'Please complete the authentication process in the terminal and try uploading again.'
                    );
                  }
                } else if (response === showDocs) {
                  vscode.env.openExternal(vscode.Uri.parse('https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1558708800.html'));
                }

                // Since we've handled the auth error explicitly, we'll return early
                return;
              }

              throw new Error(uploadResult.error || 'Unknown error');
            }
            outputChannel.appendLine('Upload to NetSuite successful');

            // Refresh the backup explorer to show new backups
            outputChannel.appendLine('Refreshing backup explorer...');
            backupExplorer.refresh();

            // Step 6: Check for differences between versions
            outputChannel.appendLine('Step 6: Comparing versions...');
            progress.report({ message: 'Comparing versions...', increment: 5 });
            let hasDifferences = false;

            if (accountBackupPath) {
              // Check if the account backup has content (size > 0)
              const accountStats = fs.statSync(accountBackupPath);
              if (accountStats.size === 0) {
                outputChannel.appendLine('WARNING: Account backup file is empty. The file may not exist in NetSuite yet.');
                vscode.window.showInformationMessage(
                  'The file was not found in NetSuite or could not be downloaded. This may be a new file that has not yet been uploaded.'
                );
              }

              outputChannel.appendLine(`Comparing files: ${backupPath} and ${accountBackupPath}`);
              hasDifferences = await backupManager.compareFiles(backupPath, accountBackupPath);
              outputChannel.appendLine(`Comparison result: ${hasDifferences ? 'Differences found' : 'No differences'}`);
            } else {
              outputChannel.appendLine('No account backup to compare with');
            }

            // Calculate total processing time
            const processingTime = Date.now() - startTime;
            outputChannel.appendLine(`Total processing time: ${processingTime}ms`);

            // Final report
            progress.report({ message: 'Complete', increment: 0 });

            if (hasDifferences) {
              outputChannel.appendLine('Showing differences notification...');
              const viewDiffOption = 'View Differences';
              const response = await vscode.window.showInformationMessage(
                'File processed successfully. Differences detected between local and account versions.',
                viewDiffOption
              );

              if (response === viewDiffOption && accountBackupPath) {
                outputChannel.appendLine('User selected to view differences');
                // Set a timeout for the diff view operation in case it hangs
                const diffViewTimeoutMs = 15000; // 15 seconds
                outputChannel.appendLine(`Setting diff view timeout to ${diffViewTimeoutMs}ms`);

                const diffPromise = vscode.commands.executeCommand(
                  'vscode.diff',
                  vscode.Uri.file(backupPath),
                  vscode.Uri.file(accountBackupPath),
                  'Local ↔ Account'
                );

                // Create a timeout promise
                const timeoutPromise = new Promise((_resolve, _reject) => {
                  setTimeout(() => {
                    outputChannel.appendLine(`WARNING: Diff view operation taking longer than expected`);
                    // We don't reject here, just log a warning since the diff view is not critical
                  }, diffViewTimeoutMs);
                });

                // Use Promise.race but don't fail if the diff takes too long
                // The non-critical operation should continue in the background
                outputChannel.appendLine('Starting diff view operation...');
                Promise.race([diffPromise, timeoutPromise])
                  .then(() => {
                    outputChannel.appendLine('Diff view operation completed');
                  })
                  .catch(error => {
                    outputChannel.appendLine(`Error in diff view: ${error instanceof Error ? error.message : String(error)}`);
                    // Don't throw errors from the diff view operation,
                    // as it's not critical to the overall process
                  });
              }
            } else {
              outputChannel.appendLine('Showing no differences notification');
              vscode.window.showInformationMessage(
                'File processed successfully. No differences detected.'
              );
            }

            outputChannel.appendLine('File processing completed successfully');
          } catch (error) {
            outputChannel.appendLine(`ERROR during file processing: ${error instanceof Error ? error.message : String(error)}`);
            if (error instanceof Error && error.stack) {
              outputChannel.appendLine(`Error stack: ${error.stack}`);
            }

            // If there was an error but we created a local backup, try to restore from it
            if (backupPath && uri) {
              try {
                outputChannel.appendLine(`Attempting emergency restore from local backup after error: ${backupPath}`);
                await backupManager.restoreFile(uri, backupPath);
                outputChannel.appendLine('Emergency restore completed successfully');
              } catch (restoreError) {
                outputChannel.appendLine(`Emergency restore failed: ${restoreError instanceof Error ? restoreError.message : String(restoreError)}`);
                if (restoreError instanceof Error && restoreError.stack) {
                  outputChannel.appendLine(`Error stack: ${restoreError.stack}`);
                }
              }
            }

            throw error;
          }
        });
      } catch (error) {
        outputChannel.appendLine(`COMMAND ERROR: ${error instanceof Error ? error.message : String(error)}`);
        if (error instanceof Error && error.stack) {
          outputChannel.appendLine(`Error stack: ${error.stack}`);
        }
        vscode.window.showErrorMessage(`Operation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      outputChannel.appendLine('=== Command: suitecloudbackup.uploadFile (End) ===');
    });

    // Register the refresh account info command
    const refreshAccountInfoCommand = vscode.commands.registerCommand(
      'suitecloudbackup.refreshAccountInfo',
      async () => {
        outputChannel.appendLine('=== Command: suitecloudbackup.refreshAccountInfo ===');
        try {
          outputChannel.appendLine('Refreshing account information...');
          await suiteCloudManager.refreshAccountInfo();
          outputChannel.appendLine('Account information refreshed successfully');

          outputChannel.appendLine('Refreshing backup explorer...');
          backupExplorer.refresh();
          outputChannel.appendLine('Backup explorer refreshed');

          vscode.window.showInformationMessage('Account information refreshed successfully.');
        } catch (error) {
          outputChannel.appendLine(`ERROR refreshing account info: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error && error.stack) {
            outputChannel.appendLine(`Error stack: ${error.stack}`);
          }
          vscode.window.showErrorMessage(`Failed to refresh account information: ${error instanceof Error ? error.message : String(error)}`);
        }
        outputChannel.appendLine('=== Command: suitecloudbackup.refreshAccountInfo (End) ===');
      }
    );

    // Register the manage backups command
    const manageBackupsCommand = vscode.commands.registerCommand(
      'suitecloudbackup.manageBackups',
      () => {
        vscode.commands.executeCommand('suitecloudbackup-explorer.focus');
      }
    );

    // Register the restore backup command (called from backup explorer)
    const restoreBackupCommand = vscode.commands.registerCommand(
      'suitecloudbackup.restoreBackup',
      async (backup: any) => {
        try {
          outputChannel.appendLine(`=== Command: suitecloudbackup.restoreBackup ===`);

          // Validate backup object properties
          if (!backup) {
            outputChannel.appendLine(`ERROR: Backup object is undefined`);
            vscode.window.showErrorMessage('Failed to restore backup: Invalid backup data');
            return;
          }

          outputChannel.appendLine(`Backup object: ${JSON.stringify(backup, null, 2)}`);

          if (!backup.backupPath) {
            outputChannel.appendLine(`ERROR: backup.backupPath is undefined`);
            vscode.window.showErrorMessage('Failed to restore backup: Missing backup file path');
            return;
          }

          if (!backup.targetPath) {
            outputChannel.appendLine(`ERROR: backup.targetPath is undefined`);
            vscode.window.showErrorMessage('Failed to restore backup: Missing target file path');
            return;
          }

          // Verify files exist before trying to restore
          if (!fs.existsSync(backup.backupPath)) {
            outputChannel.appendLine(`ERROR: Backup file does not exist: ${backup.backupPath}`);
            vscode.window.showErrorMessage(`Backup file not found: ${path.basename(backup.backupPath)}`);
            return;
          }

          const targetUri = vscode.Uri.file(backup.targetPath);
          outputChannel.appendLine(`Restoring from: ${backup.backupPath}`);
          outputChannel.appendLine(`Restoring to: ${backup.targetPath}`);

          await backupManager.restoreFile(targetUri, backup.backupPath);
          vscode.window.showInformationMessage(`Backup restored: ${path.basename(backup.targetPath)}`);
          outputChannel.appendLine(`Backup restored successfully`);
        } catch (error) {
          outputChannel.appendLine(`ERROR in restore command: ${error instanceof Error ? error.message : String(error)}`);
          vscode.window.showErrorMessage(`Failed to restore backup: ${error instanceof Error ? error.message : String(error)}`);
        }
        outputChannel.appendLine(`=== Command: suitecloudbackup.restoreBackup (End) ===`);
      }
    );

    // Register the view diff command (called when clicking on a backup in the explorer)
    const viewBackupDiffCommand = vscode.commands.registerCommand(
      'suitecloudbackup.viewBackupDiff',
      (backup: any) => {
        outputChannel.appendLine(`=== Command: suitecloudbackup.viewBackupDiff ===`);

        // Validate backup object properties
        if (!backup) {
          outputChannel.appendLine(`ERROR: Backup object is undefined`);
          vscode.window.showErrorMessage('Could not open diff view: Invalid backup data');
          return;
        }

        outputChannel.appendLine(`Backup object: ${JSON.stringify(backup, null, 2)}`);

        // Check if backup object and required properties exist
        if (!backup.backupPath) {
          outputChannel.appendLine(`ERROR: backup.backupPath is undefined`);
          vscode.window.showErrorMessage('Could not open diff view: Missing backup file path');
          return;
        }

        if (!backup.targetPath) {
          outputChannel.appendLine(`ERROR: backup.targetPath is undefined`);
          vscode.window.showErrorMessage('Could not open diff view: Missing target file path');
          return;
        }

        // Verify files exist before trying to open diff view
        if (!fs.existsSync(backup.targetPath)) {
          outputChannel.appendLine(`ERROR: Target file does not exist: ${backup.targetPath}`);
          vscode.window.showErrorMessage(`Target file not found: ${path.basename(backup.targetPath)}`);
          return;
        }

        if (!fs.existsSync(backup.backupPath)) {
          outputChannel.appendLine(`ERROR: Backup file does not exist: ${backup.backupPath}`);
          vscode.window.showErrorMessage(`Backup file not found: ${path.basename(backup.backupPath)}`);
          return;
        }

        const targetUri = vscode.Uri.file(backup.targetPath);
        const backupUri = vscode.Uri.file(backup.backupPath);

        outputChannel.appendLine(`Opening diff view between: ${backup.targetPath} and ${backup.backupPath}`);

        vscode.commands.executeCommand(
          'vscode.diff',
          targetUri,
          backupUri,
          `Current ↔ ${backup.displayName || 'Backup'}`
        );

        outputChannel.appendLine(`Diff view opened successfully`);
        outputChannel.appendLine(`=== Command: suitecloudbackup.viewBackupDiff (End) ===`);
      }
    );

    // Register context menu command for restore (passing the selected tree node as context)
    const contextRestoreBackupCommand = vscode.commands.registerCommand(
      'suitecloudbackup.contextRestoreBackup',
      (item: any) => {
        outputChannel.appendLine(`=== Command: suitecloudbackup.contextRestoreBackup ===`);

        // Debug the item being received
        outputChannel.appendLine(`Received context item: ${JSON.stringify(item, null, 2)}`);

        // Extract backup object from the tree item
        const backup = item?.command?.arguments?.[0];

        if (!backup) {
          outputChannel.appendLine(`ERROR: Failed to extract backup data from tree item`);
          vscode.window.showErrorMessage('Failed to restore backup: Invalid backup data');
          return;
        }

        // Forward to the restore command with the extracted data
        vscode.commands.executeCommand('suitecloudbackup.restoreBackup', backup);
        outputChannel.appendLine(`=== Command: suitecloudbackup.contextRestoreBackup (End) ===`);
      }
    );

    // Register command to check and fix authentication credentials
    const checkAuthCommand = vscode.commands.registerCommand('suitecloudbackup.checkAuth', async () => {
      const result = await checkCredentialsDirectory(outputChannel);
      if (result) {
        vscode.window.showInformationMessage('SuiteCloud authentication directory verified successfully.');

        // Get the project root directory
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          outputChannel.appendLine('No workspace folder found for authentication check');
          return;
        }

        const projectRoot = workspaceFolders[0].uri.fsPath;

        // Get the authId from configuration
        const authId = vscode.workspace.getConfiguration('suitecloudbackup').get<string>('defaultAuthId');

        // Verify authentication
        const authValid = await verifyAuthentication(authId, projectRoot, outputChannel);

        if (authValid) {
          vscode.window.showInformationMessage(`Authentication ID "${authId}" is valid and ready to use.`);
        } else {
          const setupAuth = 'Setup Authentication';
          const viewDocs = 'View Documentation';
          const response = await vscode.window.showWarningMessage(
            `Authentication ID "${authId}" is not valid. Would you like to set up authentication now?`,
            setupAuth,
            viewDocs
          );

          if (response === setupAuth) {
            try {
              // Try to use the original SuiteCloud extension for setup if available
              await vscode.commands.executeCommand('suitecloud.setupaccount');
            } catch (error) {
              outputChannel.appendLine(`Error running setup: ${error}`);
              // Fallback to manual terminal
              const terminal = vscode.window.createTerminal('NetSuite Authentication');
              terminal.show();
              terminal.sendText('suitecloud account:setup');
            }
          } else if (response === viewDocs) {
            vscode.env.openExternal(vscode.Uri.parse('https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1558708800.html'));
          }
        }
      } else {
        const setupAuth = 'Setup Authentication';
        const viewDocs = 'View Documentation';
        const response = await vscode.window.showWarningMessage(
          'SuiteCloud authentication issues detected. Would you like to set up authentication now?',
          setupAuth,
          viewDocs
        );

        if (response === setupAuth) {
          try {
            await vscode.commands.executeCommand('suitecloud.setupaccount');
          } catch (error) {
            outputChannel.appendLine(`Error running setup: ${error}`);
            const terminal = vscode.window.createTerminal('NetSuite Authentication');
            terminal.show();
            terminal.sendText('suitecloud account:setup');
          }
        } else if (response === viewDocs) {
          vscode.env.openExternal(vscode.Uri.parse('https://docs.oracle.com/en/cloud/saas/netsuite/ns-online-help/chapter_1558708800.html'));
        }
      }
    });

    // Add command to properly set the auth ID according to official SuiteCloud SDK practices
    const setAuthIdCommand = vscode.commands.registerCommand('suitecloudbackup.setAuthId', async () => {
      try {
        outputChannel.appendLine('=== SETTING AUTHENTICATION ID ===');
        // Get the project root directory
        const projectRoot = suiteCloudManager.getProjectRoot();

        if (!projectRoot) {
          vscode.window.showErrorMessage('No project root directory found. Open a SuiteCloud project first.');
          return;
        }

        // Run the list command to get available auth IDs
        outputChannel.appendLine(`Getting available authentication IDs...`);

        // Try to use the native SuiteCloud extension's command first
        try {
          outputChannel.appendLine('Attempting to use native SuiteCloud extension for auth listing...');

          // This should invoke the native SuiteCloud auth command which will show their UI
          await vscode.commands.executeCommand('suitecloud.setupaccount');

          // If we reached here, we don't need to continue with our own picker
          outputChannel.appendLine('Using native SuiteCloud authentication selection');
          return;
        } catch (nativeError) {
          outputChannel.appendLine(`Native SuiteCloud extension not available or failed: ${nativeError}`);
          outputChannel.appendLine('Falling back to manual authentication ID selection');
        }

        // Fallback to our own command if the native one is not available
        try {
          const result = await exec('suitecloud account:manageauth --list', { cwd: projectRoot });

          if (!result.stdout) {
            vscode.window.showErrorMessage('Failed to get authentication IDs. Make sure SuiteCloud CLI is installed.');
            return;
          }

          // Parse the available auth IDs using the same format as native SuiteCloud
          const authList = result.stdout.split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            // Filter out any lines that don't match the expected format
            .filter(line => line.includes('|'));

          const authOptions = authList.map(line => {
            const parts = line.split('|').map(part => part.trim());
            const id = parts[0];

            // Use the same display format as native SuiteCloud
            let displayName = id;
            if (parts.length > 1) {
              const accountInfo = parts[1];
              displayName = `${id} (${accountInfo})`;
            }

            return { label: displayName, value: id };
          });

          if (authOptions.length === 0) {
            const setupNow = 'Setup Now';
            const cancel = 'Cancel';
            const response = await vscode.window.showWarningMessage(
              'No authentication IDs found. Would you like to set up authentication now?',
              setupNow,
              cancel
            );

            if (response === setupNow) {
              try {
                await vscode.commands.executeCommand('suitecloud.setupaccount');
              } catch (error) {
                outputChannel.appendLine(`Error running setup: ${error}`);
                // Fallback to manual terminal
                const terminal = vscode.window.createTerminal('NetSuite Authentication');
                terminal.show();
                terminal.sendText('suitecloud account:setup');
              }
            }

            return;
          }

          // Show quick pick to select auth ID
          const selectedOption = await vscode.window.showQuickPick(authOptions, {
            placeHolder: 'Select the authentication ID to use',
            title: 'Set SuiteCloud Authentication ID'
          });

          if (!selectedOption) {
            outputChannel.appendLine('User cancelled auth ID selection');
            return;
          }

          const selectedId = selectedOption.value;

          // Update the setting
          await vscode.workspace.getConfiguration('suitecloudbackup').update('defaultAuthId', selectedId, vscode.ConfigurationTarget.Workspace);
          outputChannel.appendLine(`Updated defaultAuthId setting to: ${selectedId}`);

          // Set it in the SuiteCloudManager
          suiteCloudManager.setAuthId(selectedId);

          // Create or update the project.json file if it doesn't exist
          const projectJsonPath = path.join(projectRoot, 'project.json');
          let projectData = {};

          // Read existing project.json if it exists
          if (fs.existsSync(projectJsonPath)) {
            try {
              projectData = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
              outputChannel.appendLine(`Read existing project.json`);
            } catch (error) {
              outputChannel.appendLine(`Error reading project.json: ${error}`);
            }
          }

          // Update the defaultAuthId
          projectData = {
            ...projectData,
            defaultAuthId: selectedId
          };

          // Write back to project.json
          try {
            fs.writeFileSync(projectJsonPath, JSON.stringify(projectData, null, 2), 'utf8');
            outputChannel.appendLine(`Updated project.json with new defaultAuthId: ${selectedId}`);
          } catch (error) {
            outputChannel.appendLine(`Error updating project.json: ${error}`);
          }

          // Show confirmation
          vscode.window.showInformationMessage(`Authentication ID set to: ${selectedId}`);

          // Refresh account info
          await suiteCloudManager.refreshAccountInfo();
        } catch (error) {
          outputChannel.appendLine(`Error getting authentication IDs: ${error}`);
          vscode.window.showErrorMessage(`Failed to get authentication IDs: ${error instanceof Error ? error.message : String(error)}`);
        }
      } catch (error) {
        outputChannel.appendLine(`Error setting auth ID: ${error}`);
        vscode.window.showErrorMessage('Failed to set authentication ID');
      }
    });

    // Register subscriptions
    outputChannel.appendLine('Registering subscription handlers...');
    context.subscriptions.push(
      uploadFileCommand,
      manageBackupsCommand,
      restoreBackupCommand,
      viewBackupDiffCommand,
      refreshAccountInfoCommand,
      checkAuthCommand,
      contextRestoreBackupCommand,
      setAuthIdCommand,
      vscode.commands.registerCommand('suitecloudbackup.setupAuthentication', setupAuthentication),
      vscode.commands.registerCommand('suitecloudbackup.setupSpecificAuthentication', (authId?: string) =>
        setupSpecificAuthentication(authId, context, outputChannel)
      )
    );
    outputChannel.appendLine('Command subscriptions registered successfully');

    // Register status bar item
    outputChannel.appendLine('Creating status bar item...');
    const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.text = "$(cloud-upload) SuiteCloud";
    statusBarItem.tooltip = "Upload with SuiteCloud Backup";
    statusBarItem.command = 'suitecloudbackup.uploadFile';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    outputChannel.appendLine('Status bar item created and shown');

    outputChannel.appendLine('Extension activation completed successfully');

    // Return the extension API
    return {
      backupExplorer: backupExplorer,
      backupManager: backupManager,
      suiteCloudManager: suiteCloudManager
    };
  } catch (error) {
    outputChannel.appendLine(`CRITICAL ERROR during extension activation: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      outputChannel.appendLine(`Error stack: ${error.stack}`);
    }
    throw error;
  }
}

export function deactivate() {}