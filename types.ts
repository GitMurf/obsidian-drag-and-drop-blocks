import { App, TFile, WorkspaceLeaf, SearchMatches, View, SearchComponent, Editor, Vault } from 'obsidian';

declare module "obsidian" {
    interface WorkspaceLeaf {
        containerEl: HTMLElement;
    }
    interface lineCoordinates {
        top: number;
        bottom: number;
        left: number;
        right: number;
    }
    interface Editor {
        posAtCoords: (left: number, top: number) => EditorPosition;
        coordsAtPos: (pos: EditorPosition) => lineCoordinates;
    }

    interface VaultSettings {
        'useTab': boolean;
        'tabSize': number;
    }
    interface Vault {
        config: {};
        //getConfig: (setting: string) => boolean | number | string;
        getConfig<T extends keyof VaultSettings>(setting: T): VaultSettings[T];
    }
}

export type charPos = number;

export interface Info {
    childTop: number;
    computed: boolean;
    height: number;
    hidden: boolean;
    queued: boolean;
    width: number;
}

export interface SearchResultChild {
    el: HTMLDivElement;
    end: charPos;
    info: Info;
    matches: SearchMatches;
    onMatchRender: null;
    parent: {};
    start: charPos;
}

export interface SearchResultByFile {
    app: App;
    children: Array<SearchResultChild>;
    childrenEl: HTMLDivElement;
    collapseEl: HTMLDivElement;
    collapsed: boolean;
    collapsible: boolean;
    containerEl: HTMLDivElement;
    content: string;
    el: HTMLDivElement;
    extraContext: boolean;
    file: TFile;
    info: Info;
    onMatchRender: null;
    parent: {};
    pusherEl: HTMLDivElement;
    result: {
        content: SearchMatches;
        separateMatches: boolean;
        showTitle: boolean;
    }
    separateMatches: boolean;
    showTitle: boolean;
}

export interface SearchLeaf extends WorkspaceLeaf {
    view: SearchView;
}

export interface InfinityScroll {
    height: number;
    lastScroll: number;
    queued: null;
    rootEl: SearchViewDom;
    scrollEl: HTMLDivElement;
    setWidth: boolean;
    width: number;
}

export interface SearchViewDom {
    app: App;
    changed: Function;
    children: Array<SearchResultByFile>;
    childrenEl: HTMLDivElement;
    cleared: boolean;
    collapseAll: boolean;
    el: HTMLDivElement;
    emptyStateEl: HTMLDivElement;
    extraContext: boolean;
    hoverPopover: null;
    infinityScroll: InfinityScroll;
    info: Info;
    pusherEl: HTMLDivElement;
    resultDomLookup: Array<SearchResultByFile>;
    showingEmptyState: boolean;
    sortOrder: string;
    working: boolean;
}

export interface SearchView extends View {
    collapseAllButtonEl: HTMLDivElement;
    dom: SearchViewDom;
    explainSearch: boolean;
    explainSearchButtonEl: HTMLDivElement;
    extraContextButtonEl: HTMLDivElement;
    headerDom: {
        app: App;
        navButtonsEl: HTMLDivElement;
        navHeaderEl: HTMLDivElement;
    }
    matchingCase: boolean;
    matchingCaseButtonEl: HTMLDivElement;
    queue: {}
    recentSearches: Array<any>;
    requestSaveSearch: Function;
    searchComponent: SearchComponent;
    searchInfoEl: HTMLDivElement;
    searchQuery: {
        caseSensitive: boolean;
        matcher: {}
        query: string;
        requiredInputs: {
            content: boolean;
        }
    }
}