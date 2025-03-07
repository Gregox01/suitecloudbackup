import * as vscode from 'vscode';
import * as path from 'path';
import { BackupManager } from './backupManager';

class BackupItem extends vscode.TreeItem {
  iconPath?: vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };

  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    contextValue: string,
    public readonly resourceUri?: vscode.Uri,
    public readonly command?: vscode.Command,
    public readonly description?: string,
    public readonly tooltip?: string
  ) {
    super(label, collapsibleState);
    this.resourceUri = resourceUri;
    this.command = command;
    this.contextValue = contextValue;
    this.description = description;
    this.tooltip = tooltip;
  }
}

export class BackupExplorer implements vscode.TreeDataProvider<BackupItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<BackupItem | undefined | null | void> = new vscode.EventEmitter<BackupItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<BackupItem | undefined | null | void> = this._onDidChangeTreeData.event;

  private backupManager: BackupManager;
  private backups: Map<string, Array<{
    path: string,
    timestamp: Date,
    source: string,
    authId: string,
    accountInfo: {
      name: string,
      id: string,
      url: string
    }
  }>> = new Map();

  constructor(context: vscode.ExtensionContext, backupManager: BackupManager) {
    this.backupManager = backupManager;

    // Register the tree view
    const treeView = vscode.window.createTreeView('suitecloudbackup-explorer', {
      treeDataProvider: this,
      showCollapseAll: true
    });

    context.subscriptions.push(treeView);

    // Subscribe to backup changes
    context.subscriptions.push(
      this.backupManager.onDidChangeBackups(() => this.refresh())
    );

    // Load backups immediately
    this.refresh();
  }

  public refresh(): void {
    this.loadBackups().then(() => {
      this._onDidChangeTreeData.fire();
    });
  }

  private async loadBackups(): Promise<void> {
    this.backups = await this.backupManager.listBackups();
  }

  getTreeItem(element: BackupItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: BackupItem): Promise<BackupItem[]> {
    if (!element) {
      // Root level - show files with backups
      return this.getFileNodes();
    } else if (element.contextValue === 'file') {
      // File level - show backups for this file
      return this.getBackupNodes(element.resourceUri!.fsPath);
    }

    return [];
  }

  private getFileNodes(): BackupItem[] {
    const fileNodes: BackupItem[] = [];

    for (const [filePath, backups] of this.backups.entries()) {
      if (backups.length > 0) {
        // Get the relative path to show in the UI
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let displayPath = filePath;

        if (workspaceFolders && workspaceFolders.length > 0) {
          const workspaceRoot = workspaceFolders[0].uri.fsPath;
          if (filePath.startsWith(workspaceRoot)) {
            displayPath = path.relative(workspaceRoot, filePath);
          }
        }

        // Format the last backup time
        const latestBackup = backups.reduce((latest, current) =>
          current.timestamp > latest.timestamp ? current : latest
        );

        const timeAgo = this.formatTimeAgo(latestBackup.timestamp);

        // Create tree item for the file
        const fileNode = new BackupItem(
          path.basename(filePath),
          vscode.TreeItemCollapsibleState.Collapsed,
          'file',
          vscode.Uri.file(filePath),
          undefined,
          `${backups.length} backups, last: ${timeAgo}`,
          displayPath
        );

        fileNode.iconPath = new vscode.ThemeIcon('file');

        fileNodes.push(fileNode);
      }
    }

    return fileNodes.sort((a, b) => a.label.localeCompare(b.label));
  }

  private getBackupNodes(filePath: string): BackupItem[] {
    const backupNodes: BackupItem[] = [];
    const backups = this.backups.get(filePath);

    if (!backups) {
      return [];
    }

    // Sort backups by timestamp (newest first)
    const sortedBackups = [...backups].sort((a, b) =>
      b.timestamp.getTime() - a.timestamp.getTime()
    );

    for (const backup of sortedBackups) {
      const formattedDate = backup.timestamp.toLocaleString();
      const timeAgo = this.formatTimeAgo(backup.timestamp);

      // Create a descriptive label with environment info
      let labelPrefix = backup.source === 'local' ? 'Local' : 'Account';

      // Add account information if available
      let accountInfo = '';
      if (backup.accountInfo && (backup.accountInfo.name || backup.accountInfo.id)) {
        if (backup.accountInfo.name) {
          accountInfo = backup.accountInfo.name;
        } else if (backup.accountInfo.id) {
          accountInfo = `Account #${backup.accountInfo.id}`;
        }
      }

      // Add auth ID if no account info is available
      if (!accountInfo && backup.authId) {
        accountInfo = `Auth: ${backup.authId}`;
      }

      // Create the full label
      const label = accountInfo
        ? `${labelPrefix} (${accountInfo}) - ${timeAgo}`
        : `${labelPrefix} - ${timeAgo}`;

      // Create tooltip with all available information
      let tooltipInfo = `${backup.source === 'local' ? 'Local' : 'Account'} backup from ${formattedDate}`;

      if (backup.authId) {
        tooltipInfo += `\nAuth ID: ${backup.authId}`;
      }

      if (backup.accountInfo) {
        if (backup.accountInfo.name) {
          tooltipInfo += `\nAccount: ${backup.accountInfo.name}`;
        }
        if (backup.accountInfo.id) {
          tooltipInfo += `\nAccount ID: ${backup.accountInfo.id}`;
        }
        if (backup.accountInfo.url) {
          tooltipInfo += `\nURL: ${backup.accountInfo.url}`;
        }
      }

      // Create the backup data for commands
      const backupData = {
        backupPath: backup.path,
        targetPath: filePath,
        displayName: `${backup.source === 'local' ? 'Local' : 'Account'} Backup`,
        source: backup.source,
        timestamp: backup.timestamp
      };

      const backupNode = new BackupItem(
        label,
        vscode.TreeItemCollapsibleState.None,
        `backup-${backup.source}`,
        vscode.Uri.file(backup.path),
        {
          command: 'suitecloudbackup.viewBackupDiff',
          title: 'View Diff',
          arguments: [backupData]
        },
        formattedDate,
        tooltipInfo
      );

      // Add command for Restore action
      backupNode.contextValue = `backup-${backup.source}`;

      backupNode.iconPath = new vscode.ThemeIcon(
        backup.source === 'local' ? 'desktop-download' : 'cloud-download'
      );

      backupNodes.push(backupNode);
    }

    return backupNodes;
  }

  private formatTimeAgo(date: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    if (diffDays > 0) {
      return diffDays === 1 ? 'yesterday' : `${diffDays} days ago`;
    } else if (diffHours > 0) {
      return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    } else if (diffMins > 0) {
      return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    } else {
      return 'just now';
    }
  }
}