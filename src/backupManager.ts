import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';

export class BackupManager {
  private outputChannel: vscode.OutputChannel;
  private baseBackupDir: string;

  constructor(_context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;

    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      throw new Error('No workspace folder found');
    }

    // Set up backup directory
    const backupDir = vscode.workspace.getConfiguration('suitecloudbackup').get<string>('backupDirectory');
    if (backupDir) {
      this.baseBackupDir = path.isAbsolute(backupDir)
        ? backupDir
        : path.join(workspaceFolders[0].uri.fsPath, backupDir);
    } else {
      this.baseBackupDir = path.join(workspaceFolders[0].uri.fsPath, 'backups');
    }

    // Ensure backup directory exists
    this.ensureDirectoryExists(this.baseBackupDir);

    this.log(`Backup directory: ${this.baseBackupDir}`);
  }

  private log(message: string): void {
    this.outputChannel.appendLine(`[BackupManager] ${message}`);
  }

  private async ensureDirectoryExists(dirPath: string): Promise<void> {
    try {
      if (!existsSync(dirPath)) {
        mkdirSync(dirPath, { recursive: true });
        this.log(`Created directory: ${dirPath}`);
      }
    } catch (error) {
      this.log(`Failed to create directory: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to create directory: ${dirPath}`);
    }
  }

  public async createBackup(uri: vscode.Uri, source: 'local' | 'account'): Promise<string> {
    try {
      // Get the authentication ID from workspace settings or config
      const authId = await this.getAuthId();
      if (!authId) {
        throw new Error('No authentication ID found');
      }

      // Calculate backup directory structure
      const relativePath = this.getRelativePath(uri.fsPath);
      const fileDir = path.dirname(relativePath);
      const fileName = path.basename(relativePath);

      // Create backup directory
      const backupDir = path.join(this.baseBackupDir, authId, source, fileDir);
      await this.ensureDirectoryExists(backupDir);

      // Create backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `${fileName}.${timestamp}.bak`;
      const backupPath = path.join(backupDir, backupFileName);

      // Create metadata file
      const metadataPath = `${backupPath}.meta.json`;
      const metadata = {
        originalFile: uri.fsPath,
        timestamp: new Date().toISOString(),
        source,
        authId,
        relativePath
      };

      // Copy file contents
      const fileContent = await fs.readFile(uri.fsPath, 'utf8');
      await fs.writeFile(backupPath, fileContent, 'utf8');
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      this.log(`Created ${source} backup: ${backupPath}`);
      return backupPath;
    } catch (error) {
      this.log(`Backup creation error: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async restoreFile(targetUri: vscode.Uri, backupPath: string): Promise<void> {
    try {
      // Read backup content
      const backupContent = await fs.readFile(backupPath, 'utf8');

      // Write content to target file
      await fs.writeFile(targetUri.fsPath, backupContent, 'utf8');

      this.log(`Restored file from backup: ${targetUri.fsPath}`);
    } catch (error) {
      this.log(`Restore error: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to restore file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async compareFiles(file1Path: string, file2Path: string): Promise<boolean> {
    try {
      const content1 = await fs.readFile(file1Path, 'utf8');
      const content2 = await fs.readFile(file2Path, 'utf8');

      return content1 !== content2;
    } catch (error) {
      this.log(`Comparison error: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to compare files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async getOriginalFilePath(backupPath: string): Promise<string | null> {
    try {
      // Try to get metadata file
      const metadataPath = `${backupPath}.meta.json`;
      if (existsSync(metadataPath)) {
        const metadata = JSON.parse(await fs.readFile(metadataPath, 'utf8'));
        return metadata.originalFile;
      }

      // If no metadata, try to infer from backup path
      const backupDir = path.dirname(backupPath);
      const fileName = path.basename(backupPath).split('.').slice(0, -2).join('.');

      // Try to find the workspace root
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        return null;
      }

      // Get the backup directory structure: /backups/{authId}/{source}/{relativePath}
      const relativeDirParts = path.relative(this.baseBackupDir, backupDir).split(path.sep);

      // Remove authId and source
      if (relativeDirParts.length >= 2) {
        relativeDirParts.splice(0, 2);
      }

      const relativeDir = relativeDirParts.join(path.sep);
      const workspaceRoot = workspaceFolders[0].uri.fsPath;

      return path.join(workspaceRoot, relativeDir, fileName);
    } catch (error) {
      this.log(`Error getting original file path: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  private getRelativePath(filePath: string): string {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      return filePath;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    return path.relative(workspaceRoot, filePath);
  }

  private async getAuthId(): Promise<string | undefined> {
    // Try to get from settings
    let authId = vscode.workspace.getConfiguration('suitecloudbackup').get<string>('defaultAuthId');

    // If not found in settings, try to load from project.json
    if (!authId) {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
          const projectJsonPath = path.join(workspaceFolders[0].uri.fsPath, 'project.json');
          if (existsSync(projectJsonPath)) {
            const projectData = JSON.parse(await fs.readFile(projectJsonPath, 'utf8'));
            authId = projectData.defaultAuthId;
          }
        }
      } catch (error) {
        this.log(`Error reading project.json: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    return authId;
  }

  public async listBackups(): Promise<Map<string, Array<{ path: string, timestamp: Date, source: string }>>> {
    try {
      if (!existsSync(this.baseBackupDir)) {
        return new Map();
      }

      const backups = new Map<string, Array<{ path: string, timestamp: Date, source: string }>>();

      // List subdirectories (auth IDs)
      const authIds = await fs.readdir(this.baseBackupDir);

      for (const authId of authIds) {
        const authPath = path.join(this.baseBackupDir, authId);
        const sources = await fs.readdir(authPath);

        for (const source of sources) {
          const sourcePath = path.join(authPath, source);

          // Recursively find all backup files
          await this.findBackupFiles(sourcePath, backups, source as 'local' | 'account');
        }
      }

      return backups;
    } catch (error) {
      this.log(`Error listing backups: ${error instanceof Error ? error.message : String(error)}`);
      return new Map();
    }
  }

  private async findBackupFiles(
    directory: string,
    backups: Map<string, Array<{ path: string, timestamp: Date, source: string }>>,
    source: 'local' | 'account',
    relativePath: string = ''
  ): Promise<void> {
    try {
      const entries = await fs.readdir(directory, { withFileTypes: true });

      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          // Recursively search subdirectories
          const newRelativePath = relativePath ? path.join(relativePath, entry.name) : entry.name;
          await this.findBackupFiles(entryPath, backups, source, newRelativePath);
        } else if (entry.isFile() && entry.name.endsWith('.bak') && !entry.name.endsWith('.meta.json')) {
          // This is a backup file
          const originalPath = await this.getOriginalFilePath(entryPath);

          if (originalPath) {
            // Parse the timestamp from filename or metadata
            let timestamp: Date;

            try {
              const metaPath = `${entryPath}.meta.json`;
              if (existsSync(metaPath)) {
                const metadata = JSON.parse(await fs.readFile(metaPath, 'utf8'));
                timestamp = new Date(metadata.timestamp);
              } else {
                // Extract timestamp from filename
                const timestampStr = entry.name.split('.').slice(-2, -1)[0];
                timestamp = new Date(timestampStr.replace(/-/g, (match, offset) => {
                  if (offset === 13 || offset === 16) return ':';
                  if (offset === 10) return '.';
                  return match;
                }));
              }
            } catch (error) {
              // If timestamp parsing fails, use file modification time
              const stats = await fs.stat(entryPath);
              timestamp = stats.mtime;
            }

            // Store backup information
            if (!backups.has(originalPath)) {
              backups.set(originalPath, []);
            }

            backups.get(originalPath)?.push({
              path: entryPath,
              timestamp,
              source
            });
          }
        }
      }
    } catch (error) {
      this.log(`Error finding backup files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}