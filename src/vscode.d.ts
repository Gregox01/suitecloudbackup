declare module 'vscode' {
  export interface Thenable<T> extends Promise<T> {}

  export interface ExtensionContext {
    subscriptions: { dispose(): any }[];
    extensionPath: string;
    asAbsolutePath(relativePath: string): string;
    globalState: Memento;
    workspaceState: Memento;
    extensionUri: Uri;
    globalStoragePath: string;
    logPath: string;
    storagePath: string | undefined;
    storageUri: Uri | undefined;
    globalStorageUri: Uri;
  }

  export interface Memento {
    get<T>(key: string): T | undefined;
    get<T>(key: string, defaultValue: T): T;
    update(key: string, value: any): Thenable<void>;
  }

  export interface Uri {
    scheme: string;
    authority: string;
    path: string;
    query: string;
    fragment: string;
    fsPath: string;
    with(change: { scheme?: string; authority?: string; path?: string; query?: string; fragment?: string }): Uri;
    toString(): string;
  }

  export namespace Uri {
    export function file(path: string): Uri;
    export function parse(uri: string): Uri;
    export function joinPath(uri: Uri, ...pathSegments: string[]): Uri;
  }

  export interface TreeDataProvider<T> {
    onDidChangeTreeData?: Event<T | undefined | null | void>;
    getTreeItem(element: T): TreeItem | Thenable<TreeItem>;
    getChildren(element?: T): ProviderResult<T[]>;
    getParent?(element: T): ProviderResult<T>;
    resolveTreeItem?(item: TreeItem, element: T): ProviderResult<TreeItem>;
  }

  export class TreeItem {
    label?: string;
    id?: string;
    iconPath?: string | Uri | { light: string | Uri; dark: string | Uri } | ThemeIcon;
    description?: string | boolean;
    tooltip?: string | MarkdownString;
    command?: Command;
    contextValue?: string;
    constructor(label: string, collapsibleState?: TreeItemCollapsibleState);
    constructor(resourceUri: Uri, collapsibleState?: TreeItemCollapsibleState);
  }

  export enum TreeItemCollapsibleState {
    None = 0,
    Collapsed = 1,
    Expanded = 2
  }

  export class ThemeIcon {
    constructor(id: string, color?: ThemeColor);
    readonly id: string;
    static readonly File: ThemeIcon;
    static readonly Folder: ThemeIcon;
  }

  export class ThemeColor {
    constructor(id: string);
  }

  export interface Command {
    title: string;
    command: string;
    arguments?: any[];
  }

  export interface MarkdownString {
    value: string;
    isTrusted?: boolean;
    supportThemeIcons?: boolean;
    supportHtml?: boolean;
    baseUri?: Uri;
  }

  export class EventEmitter<T> {
    event: Event<T>;
    fire(data?: T): void;
    dispose(): void;
  }

  export interface Event<T> {
    (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]): Disposable;
  }

  export interface Disposable {
    dispose(): any;
  }

  export namespace window {
    export function createOutputChannel(name: string): OutputChannel;
    export function showInformationMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    export function showInformationMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;
    export function showWarningMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    export function showWarningMessage(message: string, options: MessageOptions, ...items: string[]): Thenable<string | undefined>;
    export function showErrorMessage(message: string, ...items: string[]): Thenable<string | undefined>;
    export function createTreeView<T>(viewId: string, options: { treeDataProvider: TreeDataProvider<T>; showCollapseAll?: boolean; canSelectMany?: boolean }): TreeView<T>;
    export function createStatusBarItem(alignment?: StatusBarAlignment, priority?: number): StatusBarItem;
    export function withProgress<R>(options: ProgressOptions, task: (progress: Progress<{ message?: string; increment?: number }>) => Thenable<R>): Thenable<R>;
    export const activeTextEditor: TextEditor | undefined;
  }

  export interface OutputChannel {
    name: string;
    append(value: string): void;
    appendLine(value: string): void;
    clear(): void;
    show(preserveFocus?: boolean): void;
    hide(): void;
    dispose(): void;
  }

  export interface MessageOptions {
    modal?: boolean;
  }

  export interface StatusBarItem extends Disposable {
    text: string;
    tooltip: string | undefined;
    command: string | undefined;
    show(): void;
    hide(): void;
  }

  export enum StatusBarAlignment {
    Left = 1,
    Right = 2
  }

  export interface Progress<T> {
    report(value: T): void;
  }

  export interface ProgressOptions {
    location: ProgressLocation;
    title?: string;
    cancellable?: boolean;
  }

  export enum ProgressLocation {
    Notification = 1,
    SourceControl = 2,
    Window = 3
  }

  export interface TextEditor {
    document: TextDocument;
    selection: Selection;
    selections: readonly Selection[];
    visibleRanges: readonly Range[];
    edit(callback: (editBuilder: TextEditorEdit) => void, options?: { undoStopBefore: boolean; undoStopAfter: boolean }): Thenable<boolean>;
    insertSnippet(snippet: SnippetString, location?: Position | Range | readonly Position[] | readonly Range[], options?: { undoStopBefore: boolean; undoStopAfter: boolean }): Thenable<boolean>;
    setDecorations(decorationType: TextEditorDecorationType, rangesOrOptions: Range[] | DecorationOptions[]): void;
    revealRange(range: Range, revealType?: TextEditorRevealType): void;
    show(column?: ViewColumn): void;
    hide(): void;
  }

  export interface TextDocument {
    uri: Uri;
    fileName: string;
    languageId: string;
    version: number;
    isDirty: boolean;
    isClosed: boolean;
    save(): Thenable<boolean>;
    getText(range?: Range): string;
    getWordRangeAtPosition(position: Position, regex?: RegExp): Range | undefined;
    lineAt(line: number | Position): TextLine;
    lineCount: number;
  }

  export interface TextLine {
    lineNumber: number;
    text: string;
    range: Range;
    rangeIncludingLineBreak: Range;
    firstNonWhitespaceCharacterIndex: number;
    isEmptyOrWhitespace: boolean;
  }

  export interface Position {
    line: number;
    character: number;
    isBefore(other: Position): boolean;
    isBeforeOrEqual(other: Position): boolean;
    isAfter(other: Position): boolean;
    isAfterOrEqual(other: Position): boolean;
    isEqual(other: Position): boolean;
    translate(lineDelta?: number, characterDelta?: number): Position;
    with(line?: number, character?: number): Position;
  }

  export interface Range {
    start: Position;
    end: Position;
    isEmpty: boolean;
    isSingleLine: boolean;
    contains(positionOrRange: Position | Range): boolean;
    isEqual(other: Range): boolean;
    intersection(range: Range): Range | undefined;
    union(other: Range): Range;
    with(start?: Position, end?: Position): Range;
  }

  export interface Selection extends Range {
    anchor: Position;
    active: Position;
    isReversed: boolean;
  }

  export interface TextEditorEdit {
    replace(location: Position | Range | Selection, value: string): void;
    insert(location: Position, value: string): void;
    delete(location: Range | Selection): void;
    setEndOfLine(endOfLine: EndOfLine): void;
  }

  export interface SnippetString {
    value: string;
    appendText(string: string): SnippetString;
    appendTabstop(number?: number): SnippetString;
    appendPlaceholder(value: string | ((snippet: SnippetString) => void), number?: number): SnippetString;
    appendChoice(values: string[], number?: number): SnippetString;
    appendVariable(name: string, defaultValue: string | ((snippet: SnippetString) => void)): SnippetString;
  }

  export interface DecorationOptions {
    range: Range;
    hoverMessage?: MarkdownString | MarkdownString[];
    renderOptions?: DecorationInstanceRenderOptions;
  }

  export interface DecorationInstanceRenderOptions {
    after?: ThemableDecorationAttachmentRenderOptions;
    before?: ThemableDecorationAttachmentRenderOptions;
  }

  export interface ThemableDecorationAttachmentRenderOptions {
    contentText?: string;
    contentIconPath?: string | Uri;
    border?: string;
    borderColor?: string | ThemeColor;
    color?: string | ThemeColor;
    fontStyle?: string;
    fontWeight?: string;
    textDecoration?: string;
  }

  export interface TextEditorDecorationType {
    key: string;
    dispose(): void;
  }

  export enum TextEditorRevealType {
    Default = 0,
    InCenter = 1,
    InCenterIfOutsideViewport = 2,
    AtTop = 3
  }

  export enum EndOfLine {
    LF = 1,
    CRLF = 2
  }

  export enum ViewColumn {
    Active = -1,
    One = 1,
    Two = 2,
    Three = 3,
    Four = 4,
    Five = 5,
    Six = 6,
    Seven = 7,
    Eight = 8,
    Nine = 9
  }

  export interface TreeView<T> extends Disposable {
    readonly onDidExpandElement: Event<TreeViewExpansionEvent<T>>;
    readonly onDidCollapseElement: Event<TreeViewExpansionEvent<T>>;
    readonly onDidChangeSelection: Event<TreeViewSelectionChangeEvent<T>>;
    readonly onDidChangeVisibility: Event<TreeViewVisibilityChangeEvent>;
    readonly visible: boolean;
    readonly selection: readonly T[];
    reveal(element: T, options?: { select?: boolean; focus?: boolean; expand?: boolean | number }): Thenable<void>;
  }

  export interface TreeViewExpansionEvent<T> {
    readonly element: T;
  }

  export interface TreeViewSelectionChangeEvent<T> {
    readonly selection: readonly T[];
  }

  export interface TreeViewVisibilityChangeEvent {
    readonly visible: boolean;
  }

  export type ProviderResult<T> = T | undefined | null | Thenable<T | undefined | null>;

  export namespace workspace {
    export const workspaceFolders: readonly WorkspaceFolder[] | undefined;
    export function getConfiguration(section?: string): WorkspaceConfiguration;
  }

  export interface WorkspaceFolder {
    readonly uri: Uri;
    readonly name: string;
    readonly index: number;
  }

  export interface WorkspaceConfiguration {
    get<T>(section: string): T | undefined;
    get<T>(section: string, defaultValue: T): T;
    has(section: string): boolean;
    update(section: string, value: any, configurationTarget?: ConfigurationTarget): Thenable<void>;
    readonly [key: string]: any;
  }

  export enum ConfigurationTarget {
    Global = 1,
    Workspace = 2,
    WorkspaceFolder = 3
  }

  export namespace commands {
    export function registerCommand(command: string, callback: (...args: any[]) => any, thisArg?: any): Disposable;
    export function executeCommand<T>(command: string, ...rest: any[]): Thenable<T | undefined>;
  }
}