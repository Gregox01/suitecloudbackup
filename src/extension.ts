import * as vscode from 'vscode';
import { SuiteCloudManager } from './suiteCloudManager';
import { BackupManager } from './backupManager';
import { BackupExplorer } from './backupExplorer';
import * as path from 'path';

export function activate(context: vscode.ExtensionContext) {
  // Initialize the output channel for logs
  const outputChannel = vscode.window.createOutputChannel('SuiteCloud Backup');
  outputChannel.appendLine('SuiteCloud Backup extension activated');

  // Initialize managers
  const backupManager = new BackupManager(context, outputChannel);
  const suiteCloudManager = new SuiteCloudManager(context, outputChannel);
  const backupExplorer = new BackupExplorer(context, backupManager);

  // Register the upload file command
  const uploadFileCommand = vscode.commands.registerCommand(
    'suitecloudbackup.uploadFile',
    async (uri?: vscode.Uri) => {
      try {
        // Get the URI of the current file if not provided
        if (!uri) {
          const activeEditor = vscode.window.activeTextEditor;
          if (!activeEditor) {
            vscode.window.showErrorMessage('No file is currently open');
            return;
          }
          uri = activeEditor.document.uri;
        }

        // Ensure URI is available
        if (!uri) {
          vscode.window.showErrorMessage('Unable to determine file path');
          return;
        }

        // Show progress indicator
        await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: `Processing ${path.basename(uri.fsPath)}`,
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: 'Creating local backup...' });
            const localBackupPath = await backupManager.createBackup(uri!, 'local');

            progress.report({ message: 'Uploading to NetSuite...' });
            const uploadResult = await suiteCloudManager.uploadFile(uri!);

            if (uploadResult.success) {
              progress.report({ message: 'Importing account version...' });
              const importResult = await suiteCloudManager.importFile(uri!);

              if (importResult.success) {
                progress.report({ message: 'Creating account backup...' });
                const accountBackupPath = await backupManager.createBackup(uri!, 'account');

                progress.report({ message: 'Restoring local version...' });
                await backupManager.restoreFile(uri!, localBackupPath);

                // Check for differences between versions
                const hasDifferences = await backupManager.compareFiles(
                  localBackupPath,
                  accountBackupPath
                );

                if (hasDifferences) {
                  const viewDiffOption = 'View Differences';
                  const response = await vscode.window.showInformationMessage(
                    'File processed successfully. Differences detected between local and account versions.',
                    viewDiffOption
                  );

                  if (response === viewDiffOption) {
                    await vscode.commands.executeCommand(
                      'vscode.diff',
                      vscode.Uri.file(localBackupPath),
                      vscode.Uri.file(accountBackupPath),
                      'Local ↔ Account'
                    );
                  }
                } else {
                  vscode.window.showInformationMessage(
                    'File processed successfully. No differences detected.'
                  );
                }
              } else {
                vscode.window.showWarningMessage(
                  `File uploaded, but could not import account version: ${importResult.error}`
                );
              }
            } else {
              vscode.window.showErrorMessage(`Upload failed: ${uploadResult.error}`);
            }
          }
        );
      } catch (error) {
        outputChannel.appendLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
        vscode.window.showErrorMessage(`Operation failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register the manage backups command
  const manageBackupsCommand = vscode.commands.registerCommand(
    'suitecloudbackup.manageBackups',
    async () => {
      try {
        backupExplorer.refresh();
        vscode.commands.executeCommand('workbench.view.extension.suitecloudbackup-explorer');
      } catch (error) {
        outputChannel.appendLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
        vscode.window.showErrorMessage(`Failed to open backup manager: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register the restore backup command
  const restoreBackupCommand = vscode.commands.registerCommand(
    'suitecloudbackup.restoreBackup',
    async (backupPath: string) => {
      try {
        if (!backupPath) {
          vscode.window.showErrorMessage('No backup selected for restoration');
          return;
        }

        // Ask for confirmation
        const confirm = await vscode.window.showWarningMessage(
          `Are you sure you want to restore from this backup? This will overwrite the current file.`,
          { modal: true },
          'Restore'
        );

        if (confirm === 'Restore') {
          const originalFilePath = await backupManager.getOriginalFilePath(backupPath);

          if (originalFilePath) {
            await backupManager.restoreFile(
              vscode.Uri.file(originalFilePath),
              backupPath
            );
            vscode.window.showInformationMessage('Backup restored successfully');
          } else {
            vscode.window.showErrorMessage('Could not determine original file path for this backup');
          }
        }
      } catch (error) {
        outputChannel.appendLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
        vscode.window.showErrorMessage(`Restore failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register the view backup diff command
  const viewBackupDiffCommand = vscode.commands.registerCommand(
    'suitecloudbackup.viewBackupDiff',
    async (backupPath: string) => {
      try {
        if (!backupPath) {
          vscode.window.showErrorMessage('No backup selected for comparison');
          return;
        }

        const originalFilePath = await backupManager.getOriginalFilePath(backupPath);

        if (originalFilePath) {
          await vscode.commands.executeCommand(
            'vscode.diff',
            vscode.Uri.file(originalFilePath),
            vscode.Uri.file(backupPath),
            `Current ↔ Backup (${path.basename(backupPath)})`
          );
        } else {
          vscode.window.showErrorMessage('Could not determine original file path for this backup');
        }
      } catch (error) {
        outputChannel.appendLine(`Error: ${error instanceof Error ? error.message : String(error)}`);
        vscode.window.showErrorMessage(`Failed to view diff: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  );

  // Register subscriptions
  context.subscriptions.push(
    uploadFileCommand,
    manageBackupsCommand,
    restoreBackupCommand,
    viewBackupDiffCommand
  );

  // Register status bar item
  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(cloud-upload) SuiteCloud";
  statusBarItem.tooltip = "Upload with SuiteCloud Backup";
  statusBarItem.command = 'suitecloudbackup.uploadFile';
  statusBarItem.show();

  context.subscriptions.push(statusBarItem);

  // Return the extension API
  return {
    backupManager,
    suiteCloudManager
  };
}

export function deactivate() {
  // Cleanup on deactivation
}