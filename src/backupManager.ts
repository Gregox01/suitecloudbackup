import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import { SuiteCloudManager, AccountInfo } from './suiteCloudManager';

export class BackupManager {
  private outputChannel: vscode.OutputChannel;
  private baseBackupDir: string;
  private suiteCloudManager?: SuiteCloudManager;
  private _onDidChangeBackups: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
  readonly onDidChangeBackups: vscode.Event<void> = this._onDidChangeBackups.event;

  constructor(_context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.outputChannel = outputChannel;
    this.log('Initializing BackupManager');

    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.log('ERROR: No workspace folder found');
      throw new Error('No workspace folder found');
    }
    this.log(`Found workspace folder: ${workspaceFolders[0].uri.fsPath}`);

    // Set up backup directory
    const backupDir = vscode.workspace.getConfiguration('suitecloudbackup').get<string>('backupDirectory');
    this.log(`Backup directory from settings: ${backupDir || 'not set'}`);

    if (backupDir) {
      this.baseBackupDir = path.isAbsolute(backupDir)
        ? backupDir
        : path.join(workspaceFolders[0].uri.fsPath, backupDir);
      this.log(`Using backup directory from settings. Path is ${path.isAbsolute(backupDir) ? 'absolute' : 'relative'}`);
    } else {
      this.baseBackupDir = path.join(workspaceFolders[0].uri.fsPath, 'backups');
      this.log('No backup directory in settings, using default "backups" in workspace root');
    }

    // Ensure backup directory exists
    try {
      this.log(`Ensuring backup directory exists: ${this.baseBackupDir}`);
      this.ensureDirectoryExists(this.baseBackupDir);
      this.log(`Backup directory confirmed: ${this.baseBackupDir}`);
    } catch (error) {
      this.log(`CRITICAL ERROR: Failed to create backup directory: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Sets the SuiteCloudManager reference to use for account information
   */
  public setSuiteCloudManager(manager: SuiteCloudManager): void {
    this.log('Setting SuiteCloudManager reference');
    this.suiteCloudManager = manager;
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
      this.log(`ERROR: Failed to create directory: ${error instanceof Error ? error.message : String(error)}`);
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

      // Create backup directory - ensure we're using the correct path structure
      const backupDir = path.join(this.baseBackupDir, authId, source, fileDir);
      await this.ensureDirectoryExists(backupDir);

      // Create backup filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupFileName = `${fileName}.${timestamp}.bak`;
      const backupPath = path.join(backupDir, backupFileName);

      // Get account info from SuiteCloudManager if available
      let accountInfo: AccountInfo = { name: '', id: '', url: '' };

      if (this.suiteCloudManager) {
        const info = this.suiteCloudManager.getAccountInfo(authId);
        if (info) {
          accountInfo = info;
          this.log(`Using account info from SuiteCloudManager: ${info.name || info.id || authId}`);
        }
      }

      // Fallback to project.json if needed
      if (!accountInfo.name && !accountInfo.id) {
        try {
          const workspaceFolders = vscode.workspace.workspaceFolders;
          if (workspaceFolders && workspaceFolders.length > 0) {
            const projectJsonPath = path.join(workspaceFolders[0].uri.fsPath, 'project.json');
            if (existsSync(projectJsonPath)) {
              const projectData = JSON.parse(await fs.readFile(projectJsonPath, 'utf8'));

              // Extract account information
              if (projectData.accountSpecificValues && projectData.accountSpecificValues[authId]) {
                const acctInfo = projectData.accountSpecificValues[authId];
                accountInfo.name = acctInfo.companyName || '';
                accountInfo.id = acctInfo.companyId || '';
                accountInfo.url = acctInfo.netSuiteUrl || '';
                this.log(`Using account info from project.json: ${accountInfo.name || accountInfo.id || authId}`);
              }
            }
          }
        } catch (error) {
          this.log(`Error reading account info: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      // Create metadata file
      const metadataPath = `${backupPath}.meta.json`;
      const metadata = {
        originalFile: uri.fsPath,
        timestamp: new Date().toISOString(),
        source,
        authId,
        relativePath,
        accountInfo
      };

      // Copy file contents
      const fileContent = await fs.readFile(uri.fsPath, 'utf8');
      await fs.writeFile(backupPath, fileContent, 'utf8');
      await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2), 'utf8');

      this.log(`Created ${source} backup: ${backupPath}`);

      // Notify listeners that backups have changed
      this._onDidChangeBackups.fire();

      return backupPath;
    } catch (error) {
      this.log(`Backup creation error: ${error instanceof Error ? error.message : String(error)}`);
      throw new Error(`Failed to create backup: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  public async restoreFile(targetUri: vscode.Uri, backupPath: string): Promise<void> {
    this.log(`========== FILE RESTORATION STARTED ==========`);
    this.log(`Restoring from backup: ${backupPath}`);
    this.log(`Target file: ${targetUri.fsPath}`);

    try {
      // Validate inputs to avoid undefined errors
      if (!backupPath) {
        throw new Error('Backup path is undefined or empty');
      }

      if (!targetUri || !targetUri.fsPath) {
        throw new Error('Target URI is invalid or missing fsPath');
      }

      this.log(`Checking if backup file exists...`);
      if (!existsSync(backupPath)) {
        const error = `Backup file not found: ${backupPath}`;
        this.log(`ERROR: ${error}`);
        throw new Error(error);
      }
      this.log(`Backup file exists, proceeding with restoration`);

      // Create a timeout promise - increase timeout for larger files
      const timeoutMs = 120000; // 120 seconds (increased from 60)
      this.log(`Setting restoration timeout to ${timeoutMs}ms`);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => {
          const timeoutError = new Error(`File restoration timed out after ${timeoutMs/1000} seconds`);
          this.log(`TIMEOUT ERROR: ${timeoutError.message}`);
          reject(timeoutError);
        }, timeoutMs);
      });

      // Read backup content with timeout
      this.log(`Reading backup file content...`);
      const startTime = Date.now();

      // Check file size before reading to estimate time needed
      const stats = await fs.stat(backupPath);
      this.log(`Backup file size: ${stats.size} bytes`);
      if (stats.size > 1024 * 1024) {
        this.log(`WARNING: Large file detected (${Math.round(stats.size/1024/1024*100)/100} MB), restoration may take longer`);
      }

      // Ensure target directory exists
      this.log(`Ensuring target directory exists...`);
      const targetDir = path.dirname(targetUri.fsPath);
      if (!targetDir) {
        throw new Error(`Invalid target directory derived from: ${targetUri.fsPath}`);
      }
      await this.ensureDirectoryExists(targetDir);
      this.log(`Target directory confirmed: ${targetDir}`);

      // Try direct file copying approach
      try {
        this.log(`Using direct file copy approach`);
        // Use native file system copy instead of reading/writing for large files
        const copyStartTime = Date.now();

        // First try Node.js fs.copyFile
        await fs.copyFile(backupPath, targetUri.fsPath);

        const copyDuration = Date.now() - copyStartTime;
        this.log(`Direct file copy completed in ${copyDuration}ms`);

        this.log(`Target file verified through direct copy: ${targetUri.fsPath}`);
        this.log(`Restoration complete: ${backupPath} to ${targetUri.fsPath}`);
        this.log(`Total restoration time: ${Date.now() - startTime}ms`);
        this.log(`========== FILE RESTORATION FINISHED ==========`);

        // Notify listeners that a restore operation occurred
        this._onDidChangeBackups.fire();
        return;
      } catch (copyError) {
        // If copy fails, fall back to manual read/write
        this.log(`Direct copy failed, falling back to manual read/write: ${copyError instanceof Error ? copyError.message : String(copyError)}`);

        // Use a buffer-based approach for larger files
        const readBackupPromise = stats.size > 5 * 1024 * 1024
          ? fs.readFile(backupPath) // Return Buffer for large files
          : fs.readFile(backupPath, 'utf8'); // Return String for smaller files

        this.log(`Waiting for read operation to complete or timeout...`);
        const backupContent = await Promise.race([readBackupPromise, timeoutPromise]);
        const readDuration = Date.now() - startTime;
        this.log(`Read operation completed in ${readDuration}ms`);

        // Write content to target file
        this.log(`Writing content to target file...`);
        const writeStartTime = Date.now();
        const writeOptions = { encoding: Buffer.isBuffer(backupContent) ? null : 'utf8' as BufferEncoding };

        // Write the file
        const writeFilePromise = fs.writeFile(targetUri.fsPath, backupContent, writeOptions);
        await Promise.race([writeFilePromise, timeoutPromise]);
        const writeDuration = Date.now() - writeStartTime;
        this.log(`Write operation completed in ${writeDuration}ms`);
      }

      // Verify file was written
      this.log(`Verifying target file exists...`);
      if (!existsSync(targetUri.fsPath)) {
        throw new Error(`Target file not found after write: ${targetUri.fsPath}`);
      }
      this.log(`Target file verified: ${targetUri.fsPath}`);

      this.log(`Restoration complete: ${backupPath} to ${targetUri.fsPath}`);
      this.log(`Total restoration time: ${Date.now() - startTime}ms`);
      this.log(`========== FILE RESTORATION FINISHED ==========`);

      // Notify listeners that a restore operation occurred
      this._onDidChangeBackups.fire();
    } catch (error) {
      this.log(`ERROR during file restoration: ${error instanceof Error ? error.message : String(error)}`);
      if (error instanceof Error && error.stack) {
        this.log(`Error stack: ${error.stack}`);
      }
      this.log(`========== FILE RESTORATION FAILED ==========`);
      throw error;
    }
  }

  public async compareFiles(file1Path: string, file2Path: string): Promise<boolean> {
    this.log(`========== FILE COMPARISON STARTED ==========`);
    this.log(`Comparing files: ${file1Path} and ${file2Path}`);

    try {
      // Check that both files exist
      this.log(`Checking if files exist...`);
      if (!existsSync(file1Path)) {
        this.log(`ERROR: First file not found: ${file1Path}`);
        throw new Error(`First file not found: ${file1Path}`);
      }
      if (!existsSync(file2Path)) {
        this.log(`ERROR: Second file not found: ${file2Path}`);
        throw new Error(`Second file not found: ${file2Path}`);
      }
      this.log(`Both files exist, proceeding with comparison`);

      // Check file sizes first
      this.log(`Checking file sizes...`);
      const stats1 = await fs.stat(file1Path);
      const stats2 = await fs.stat(file2Path);
      this.log(`File 1 size: ${stats1.size} bytes`);
      this.log(`File 2 size: ${stats2.size} bytes`);

      // If file sizes are different, we know they're different
      if (stats1.size !== stats2.size) {
        this.log(`File sizes differ, files are different`);
        this.log(`========== FILE COMPARISON FINISHED (DIFFERENT SIZES) ==========`);
        return true;
      }

      // For large files, add a warning
      if (stats1.size > 1024 * 1024) {
        this.log(`WARNING: Large files detected (${Math.round(stats1.size/1024/1024*100)/100} MB), comparison may take longer`);
      }

      // Create a timeout promise for the comparison
      const timeoutMs = 120000; // Increase from 45000 to 120000 (2 minutes)
      this.log(`Setting comparison timeout to ${timeoutMs}ms`);
      const timeoutPromise = new Promise<string>((_, reject) => {
        setTimeout(() => {
          const timeoutError = new Error(`File comparison timed out after ${timeoutMs/1000} seconds`);
          this.log(`TIMEOUT ERROR: ${timeoutError.message}`);
          reject(timeoutError);
        }, timeoutMs);
      });

      // Read file contents with timeout
      this.log(`Reading file contents...`);
      const startTime = Date.now();

      const readPromise1 = fs.readFile(file1Path, 'utf8');
      const readPromise2 = fs.readFile(file2Path, 'utf8');

      this.log(`Waiting for read operations to complete or timeout...`);

      // Use Promise.all with race to handle both reads with a single timeout
      const [content1, content2] = await Promise.all([
        Promise.race([readPromise1, timeoutPromise]),
        Promise.race([readPromise2, timeoutPromise])
      ]);

      const readDuration = Date.now() - startTime;
      this.log(`Read operations completed in ${readDuration}ms`);

      // Compare content
      this.log(`Comparing file contents...`);
      const compareStartTime = Date.now();
      const isDifferent = content1 !== content2;
      const compareDuration = Date.now() - compareStartTime;
      this.log(`Content comparison completed in ${compareDuration}ms`);
      this.log(`Comparison result: ${isDifferent ? 'Files are different' : 'Files are identical'}`);
      this.log(`Total comparison time: ${Date.now() - startTime}ms`);
      this.log(`========== FILE COMPARISON FINISHED ==========`);

      return isDifferent;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.log(`ERROR during comparison: ${errorMessage}`);
      if (error instanceof Error && error.stack) {
        this.log(`Error stack: ${error.stack}`);
      }
      this.log(`========== FILE COMPARISON FAILED ==========`);

      // If comparison fails, assume files are different to be safe
      this.log(`Assuming files are different due to error`);
      return true;
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
      this.log('ERROR: No workspace folder found for relative path calculation');
      return filePath;
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    this.log(`Calculating relative path for: ${filePath}`);
    this.log(`Workspace root: ${workspaceRoot}`);

    // Use path.relative to get a properly formatted relative path
    const relativePath = path.relative(workspaceRoot, filePath);
    this.log(`Calculated relative path: ${relativePath}`);

    // Make sure the relativePath doesn't include a drive letter (happens on Windows)
    // If it does, strip everything up to and including the colon
    if (relativePath.includes(':')) {
      this.log(`WARNING: Relative path contains drive letter: ${relativePath}`);
      const withoutDrive = relativePath.replace(/^[a-zA-Z]:[\\\/]/, '');
      this.log(`Stripped drive letter: ${withoutDrive}`);
      return withoutDrive;
    }

    return relativePath;
  }

  /**
   * Gets the workspace path for the current workspace
   * @returns The workspace path or undefined if no workspace is open
   */
  public getWorkspacePath(): string | undefined {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
      this.log('ERROR: No workspace folder found when getting workspace path');
      return undefined;
    }

    return workspaceFolders[0].uri.fsPath;
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

  public async listBackups(): Promise<Map<string, Array<{ path: string, timestamp: Date, source: string, authId: string, accountInfo: { name: string, id: string, url: string } }>>> {
    try {
      const backups = new Map<string, Array<{ path: string, timestamp: Date, source: string, authId: string, accountInfo: { name: string, id: string, url: string } }>>();

      // Check if the backup directory exists
      if (!existsSync(this.baseBackupDir)) {
        return backups;
      }

      // List subdirectories (auth IDs)
      const authIds = await fs.readdir(this.baseBackupDir);

      for (const authId of authIds) {
        const authPath = path.join(this.baseBackupDir, authId);

        // Make sure it's a directory
        const authStat = await fs.stat(authPath);
        if (!authStat.isDirectory()) {
          continue;
        }

        try {
          const sources = await fs.readdir(authPath);

          for (const source of sources) {
            const sourcePath = path.join(authPath, source);

            // Make sure source path is a directory
            try {
              const sourceStat = await fs.stat(sourcePath);
              if (sourceStat.isDirectory()) {
                // Only process valid source types
                if (source === 'local' || source === 'account') {
                  // Recursively find all backup files
                  await this.findBackupFiles(sourcePath, backups, source as 'local' | 'account');
                }
              }
            } catch (sourceError) {
              // Skip invalid source directories
              continue;
            }
          }
        } catch (authError) {
          // Skip invalid auth directories
          continue;
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
    backups: Map<string, Array<{ path: string, timestamp: Date, source: string, authId: string, accountInfo: { name: string, id: string, url: string } }>>,
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
            let authId = '';
            let accountInfo = { name: '', id: '', url: '' };

            try {
              const metaPath = `${entryPath}.meta.json`;
              if (existsSync(metaPath)) {
                const metadata = JSON.parse(await fs.readFile(metaPath, 'utf8'));
                timestamp = new Date(metadata.timestamp);
                authId = metadata.authId || '';

                // Get account info if available
                if (metadata.accountInfo) {
                  accountInfo = {
                    name: metadata.accountInfo.name || '',
                    id: metadata.accountInfo.id || '',
                    url: metadata.accountInfo.url || ''
                  };
                }
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
              source,
              authId,
              accountInfo
            });
          }
        }
      }
    } catch (error) {
      this.log(`Error finding backup files: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}