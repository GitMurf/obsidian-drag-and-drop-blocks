import { settings } from 'cluster';
import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, MarkdownView, Editor, CachedMetadata, SearchMatches, View, SearchComponent } from 'obsidian';
declare module "obsidian" {
    interface WorkspaceLeaf {
        containerEl: HTMLElement;
    }
    interface Editor {
        posAtCoords(left: number, top: number): EditorPosition;
    }
}

interface Info {
    childTop: number;
    computed: boolean;
    height: number;
    hidden: boolean;
    queued: boolean;
    width: number;
}

type charPos = number;
interface SearchResultChild {
    el: HTMLDivElement;
    end: charPos;
    info: Info;
    matches: SearchMatches;
    onMatchRender: null;
    parent: {};
    start: charPos;
}

interface SearchResultByFile {
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

interface SearchLeaf extends WorkspaceLeaf {
    view: SearchView;
}

interface InfinityScroll {
    height: number;
    lastScroll: number;
    queued: null;
    rootEl: SearchViewDom;
    scrollEl: HTMLDivElement;
    setWidth: boolean;
    width: number;
}

interface SearchViewDom {
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

interface SearchView extends View {
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

const pluginName = 'Drag and Drop Blocks';

interface MyPluginSettings {
    embed: boolean;
    autoSelect: boolean;
    aliasText: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    embed: true,
    autoSelect: false,
    aliasText: 'source'
}

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;

    //My variables
    blockRefStartLine: number;
    blockRefEmbed: string;
    blockRefNewLine: string;
    originalText: string;
    blockRefDragState: string;
    blockRefStartLeaf: WorkspaceLeaf;
    blockRefClientY: number;
    blockRefModDrag: {
        alt: boolean,
        ctrl: boolean,
        shift: boolean
    }
    blockRefModDrop: {
        alt: boolean,
        ctrl: boolean,
        shift: boolean
    }
    //For search
    searchResDiv: HTMLElement;
    searchResLink: string;
    searchResContent: string;
    searchResNewBlockRef: string;
    searchResDragType: string;
    searchResLocation: { start: charPos, end: charPos }
    searchResFile: TFile;

	async onload() {
        console.log("loading plugin: " + pluginName);

        this.blockRefStartLine = null;
        this.blockRefEmbed = null;
        this.blockRefNewLine = null;
        this.originalText = null;
        this.blockRefDragState = null;
        this.blockRefStartLeaf = null;
        this.blockRefClientY = null;
        this.blockRefModDrop = { alt: null, ctrl: null, shift: null }
        this.blockRefModDrag = { alt: null, ctrl: null, shift: null }
        //For search
        this.searchResDiv = null;
        this.searchResLink = null;
        this.searchResContent = null;
        this.searchResNewBlockRef = null;
        this.searchResDragType = null;
        this.searchResLocation = { start: null, end: null }
        this.searchResFile = null;

		await this.loadSettings();

        this.addSettingTab(new SampleSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));
        //Primarily for switching between panes or opening a new file
        this.registerEvent(this.app.workspace.on('file-open', this.onFileChange.bind(this)));
        //Primarily for when switching between Edit and Preview mode
        this.registerEvent(this.app.workspace.on('layout-change', this.onLayoutChange.bind(this)));
    }

    onLayoutReady(): void {
        //Find the main DIV that holds the left sidebar search pane
        const actDocSearch: HTMLElement = document.getElementsByClassName('workspace-split mod-horizontal mod-left-split')[0] as HTMLElement;

        this.registerDomEvent(actDocSearch, 'mouseover', (evt: MouseEvent) => {
            const mainDiv: HTMLElement = evt.target as HTMLElement;
            if (mainDiv.className === 'search-result-file-match') {
                let oldElem: HTMLElement = document.getElementById('search-res-hover');
                if (oldElem) { oldElem.remove() }
                this.searchResDiv = mainDiv;
                let docBody: HTMLBodyElement = document.getElementsByTagName('body')[0];
                const newElement: HTMLDivElement = document.createElement("div");
                newElement.id = 'search-res-hover';
                docBody.insertBefore(newElement, null);
                newElement.draggable = true;
                //newElement.innerText = "◎";
                //newElement.innerText = "❖";
                //newElement.style.fontSize = "12px";
                newElement.innerText = "⋮⋮";
                newElement.style.fontSize = "16px";
                newElement.style.fontWeight = "bold";
                newElement.style.color = "var(--text-accent-hover)";
                //newElement.style.cursor = "grab";
                newElement.style.cursor = "move";
                newElement.style.position = "absolute";
                let targetRect = mainDiv.getBoundingClientRect();
                newElement.style.top = `${targetRect.top + 5}px`;
                //newElement.style.left = `${targetRect.left - 15}px`;
                newElement.style.left = `${targetRect.left - 12}px`;

                //Search result text
                let resultText: string = mainDiv.innerText;
                let resultLength: number = resultText.length;
                let resultTextTmp: string = resultText.substring(0, resultLength - 3);

                //Find the actual line based off iterating through the search view result dom
                const searchLeaf: SearchLeaf = this.app.workspace.getLeavesOfType("search")[0] as SearchLeaf;
                if (searchLeaf) {
                    const searchView: SearchView = searchLeaf.view;
                    let fileFound = false;
                    let searchFile: TFile;
                    let finalResult: string;
                    searchView.dom.resultDomLookup.forEach(eachSearchResultByFile => {
                        if (!fileFound) {
                            const foundRightSearchFileContainer = eachSearchResultByFile.children.find(eachChild => eachChild.el === mainDiv);
                            if (foundRightSearchFileContainer) {
                                fileFound = true;
                                searchFile = eachSearchResultByFile.file;
                                let mdCache: CachedMetadata = this.app.metadataCache.getFileCache(searchFile);
                                let fileContent: string = eachSearchResultByFile.content;
                                let searchResultsForEachFile = eachSearchResultByFile.children;
                                if (searchResultsForEachFile) {
                                    searchResultsForEachFile.forEach(eachSearchResult => {
                                        if (eachSearchResult.el === mainDiv) {
                                            let findStartPos: number = eachSearchResult.start;
                                            //Check if is a list item
                                            let mdListItems = mdCache.listItems;
                                            let foundResult = false;
                                            if (mdListItems) {
                                                mdListItems.forEach(eachList => {
                                                    //The metaDataCache for list items seems to combine the position.start.col and the start.offset for the real start
                                                    if ((eachList.position.start.offset - eachList.position.start.col) <= findStartPos && eachList.position.end.offset >= findStartPos) {
                                                        if (!foundResult) {
                                                            this.searchResLocation = { start: (eachList.position.start.offset - eachList.position.start.col), end: eachList.position.end.offset };
                                                            finalResult = fileContent.substring((eachList.position.start.offset - eachList.position.start.col), eachList.position.end.offset);
                                                        }
                                                        foundResult = true;
                                                    }
                                                })
                                            }

                                            if (!foundResult) {
                                                let mdSections = mdCache.sections;
                                                if (mdSections) {
                                                    mdSections.forEach(eachSection => {
                                                        if (eachSection.position.start.offset <= findStartPos && eachSection.position.end.offset >= findStartPos) {
                                                            if (!foundResult) {
                                                                this.searchResLocation = { start: eachSection.position.start.offset, end: eachSection.position.end.offset };
                                                                finalResult = fileContent.substring(eachSection.position.start.offset, eachSection.position.end.offset);
                                                            }
                                                            foundResult = true;
                                                        }
                                                    })
                                                }
                                            }
                                        }
                                    })
                                }
                            }
                        }
                    })

                    if (finalResult) {
                        let fileName = searchFile.basename;
                        let embedOrLink: string;
                        if (this.settings.embed) { embedOrLink = '!' } else { embedOrLink = "" }
                        let finalString: string;
                        let blockid: string = "";
                        let block: string;
                        if (finalResult.startsWith('#')) {
                            finalString = finalResult;
                            blockid = finalResult.replace(/(\[|\]|#|\*|\(|\)|:|,)/g, "").replace(/(\||\.)/g, " ").trim();
                            block = `${embedOrLink}[` + `[${fileName}#${blockid}]]`;
                        } else {
                            const blockRef: RegExpMatchArray = finalResult.match(/ \^(.*)/);
                            if (blockRef) {
                                blockid = blockRef[1];
                                finalString = finalResult;
                            } else {
                                let characters: string = 'abcdefghijklmnopqrstuvwxyz0123456789';
                                let charactersLength: number = characters.length;
                                for (let i = 0; i < 7; i++) {
                                    blockid += characters.charAt(Math.floor(Math.random() * charactersLength));
                                }
                                finalString = finalResult + ` ^${blockid}`;
                            }
                            block = `${embedOrLink}[` + `[${fileName}#^${blockid}]]`;
                        }
                        this.searchResLink = block;
                        this.searchResContent = finalResult;
                        this.searchResNewBlockRef = finalString;
                        this.searchResFile = searchFile;
                    }
                }

                this.registerDomEvent(newElement, 'mouseover', (evt: MouseEvent) => {
                    const eventDiv: HTMLElement = evt.target as HTMLElement;
                    eventDiv.style.color = "var(--text-accent-hover)";
                })

                this.registerDomEvent(newElement, 'mouseout', (evt: MouseEvent) => {
                    const eventDiv: HTMLElement = evt.target as HTMLElement;
                    eventDiv.style.color = "transparent";
                })

                this.registerDomEvent(mainDiv, 'mouseleave', (evt: MouseEvent) => {
                    const oldElem: HTMLElement = document.getElementById('search-res-hover');
                    if (oldElem) { oldElem.style.color = "transparent"; }
                })

                this.registerDomEvent(newElement, 'dragstart', (evt: DragEvent) => {
                    if (evt.altKey) {
                        this.searchResDragType = 'ref';
                        evt.dataTransfer.setData("text/plain", this.searchResLink);
                    }
                    if (evt.shiftKey) {
                        this.searchResDragType = 'copy';
                        evt.dataTransfer.setData("text/plain", this.searchResContent);
                    }
                })
            }
        })

        this.registerDomEvent(actDocSearch, 'mouseleave', (evt: MouseEvent) => {
            const oldElem: HTMLElement = document.getElementById('search-res-hover');
            if (oldElem) { oldElem.style.color = "transparent"; }
        })

        //Find the main DIV that holds all the markdown panes
        const actDoc: HTMLElement = document.getElementsByClassName('workspace-split mod-vertical mod-root')[0] as HTMLElement;

        this.registerDomEvent(actDoc, 'mouseover', (evt: MouseEvent) => {
            const mainDiv: HTMLElement = evt.target as HTMLElement;
            if (mainDiv.className === 'CodeMirror-linenumber CodeMirror-gutter-elt') {
                let oldElem: HTMLElement = document.getElementById('block-ref-hover');
                if (oldElem) { oldElem.remove() }
                let docBody: HTMLBodyElement = document.getElementsByTagName('body')[0];
                const newElement: HTMLDivElement = document.createElement("div");
                newElement.id = 'block-ref-hover';
                docBody.insertBefore(newElement, null);
                newElement.draggable = true;
                //newElement.innerText = "◎";
                //newElement.innerText = "❖";
                //newElement.style.fontSize = "12px";
                newElement.innerText = "⋮⋮";
                newElement.style.fontSize = "16px";
                newElement.style.fontWeight = "bold";
                newElement.style.color = "var(--text-accent-hover)";
                //newElement.style.cursor = "grab";
                newElement.style.cursor = "move";
                newElement.style.position = "absolute";
                let targetRect = mainDiv.getBoundingClientRect();
                newElement.style.top = `${targetRect.top - 1}px`;
                newElement.style.left = `${targetRect.left - 8}px`;

                this.registerDomEvent(newElement, 'mouseover', (evt: MouseEvent) => {
                    const eventDiv: HTMLElement = evt.target as HTMLElement;
                    eventDiv.style.color = "var(--text-accent-hover)";
                })

                this.registerDomEvent(newElement, 'mouseout', (evt: MouseEvent) => {
                    const eventDiv: HTMLElement = evt.target as HTMLElement;
                    eventDiv.style.color = "transparent";
                })

                this.registerDomEvent(mainDiv, 'mouseout', (evt: MouseEvent) => {
                    const oldElem: HTMLElement = document.getElementById('block-ref-hover');
                    if (oldElem) { oldElem.style.color = "transparent"; }
                })

                //Find the leaf that is being hovered over
                let leafEl = this.app.workspace.containerEl.find(".workspace-leaf:hover");
                let allLeaves: Array<WorkspaceLeaf> = this.app.workspace.getLeavesOfType("markdown");
                let hoveredLeaf: WorkspaceLeaf = allLeaves.find(eachLeaf => eachLeaf.containerEl == leafEl);
                if (hoveredLeaf) {
                    this.blockRefStartLeaf = hoveredLeaf;
                    this.blockRefClientY = evt.clientY + 1;
                }

                this.registerDomEvent(newElement, 'dragstart', (evt: DragEvent) => {
                    let hoveredLeaf: WorkspaceLeaf = this.blockRefStartLeaf;
                    let mdView: MarkdownView;
                    if (hoveredLeaf) { mdView = hoveredLeaf.view as MarkdownView; }
                    if (mdView) {
                        this.blockRefModDrag = { alt: evt.altKey, ctrl: (evt.ctrlKey || evt.metaKey), shift: evt.shiftKey }
                        let mdEditor: Editor = mdView.editor;
                        let topPos: number = this.blockRefClientY;
                        //NOTE: mdEditor.posAtCoords(x, y) is equivalent to mdEditor.cm.coordsChar({ left: x, top: y })
                        let thisLine: number = mdEditor.posAtCoords(0, topPos).line;
                        //mdEditor.setSelection({ line: thisLine, ch: 0 }, { line: thisLine, ch: 9999 });
                        let lineContent: string = mdEditor.getLine(thisLine);

                        let blockid: string = '';
                        let finalString: string = '';
                        let block: string = '';

                        //No modifier keys held so move the block to the new location
                        if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && !this.blockRefModDrag.shift) {
                            evt.dataTransfer.setData("text/plain", lineContent);
                        }

                        //Shift key held so copy the block to the new location
                        if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && this.blockRefModDrag.shift) {
                            evt.dataTransfer.setData("text/plain", lineContent);
                        }

                        //Alt key held to create a block/header reference (CMD/Ctrl is not working for MACs so going with Alt)
                        if ((this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && !this.blockRefModDrag.shift)
                            || (this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && this.blockRefModDrag.shift)) {
                            let embedOrLink: string;
                            if (this.settings.embed) { embedOrLink = '!' } else { embedOrLink = "" }
                            //Check if header reference instead of block
                            if (lineContent.startsWith('#')) {
                                finalString = lineContent;
                                blockid = lineContent.replace(/(\[|\]|#|\*|\(|\)|:|,)/g, "").replace(/(\||\.)/g, " ").trim();
                                block = `${embedOrLink}[` + `[${mdView.file.basename}#${blockid}]]`;
                            } else {
                                const blockRef: RegExpMatchArray = lineContent.match(/ \^(.*)/);
                                if (blockRef) {
                                    blockid = blockRef[1];
                                    finalString = lineContent;
                                } else {
                                    let characters: string = 'abcdefghijklmnopqrstuvwxyz0123456789';
                                    let charactersLength: number = characters.length;
                                    for (var i = 0; i < 7; i++) {
                                        blockid += characters.charAt(Math.floor(Math.random() * charactersLength));
                                    }
                                    finalString = lineContent + ` ^${blockid}`;
                                }
                                block = `${embedOrLink}[` + `[${mdView.file.basename}#^${blockid}]]`;
                            }

                            //Text + Alias block ref
                            if (this.blockRefModDrag.shift) {
                                if (lineContent.startsWith('#')) {
                                    finalString = lineContent;
                                    block = `[` + `[${mdView.file.basename}#${blockid}|${this.settings.aliasText}]]`;
                                    block = lineContent.replace(/^#* /g, '') + ' ' + block;
                                } else {
                                    block = `[` + `[${mdView.file.basename}#^${blockid}|${this.settings.aliasText}]]`;
                                    block = lineContent.replace(/ \^.*$/, '') + ' ' + block;
                                }
                            }

                            evt.dataTransfer.setData("text/plain", block);
                        }

                        this.blockRefStartLine = thisLine;
                        this.blockRefEmbed = block;
                        this.blockRefNewLine = finalString;
                        this.originalText = lineContent;
                        this.blockRefDragState = 'start';
                    }
                })

                this.registerDomEvent(newElement, 'dragend', (evt: DragEvent) => {
                    if (this.blockRefDragState === "dropped") {
                        //Nothing right now
                    }

                    if (this.blockRefDragState === 'cancelled') {
                        //Nothing right now
                    }

                    let oldElem = document.getElementById('block-ref-hover');
                    if (oldElem) { oldElem.remove() }
                    this.blockRefStartLine = null;
                    this.blockRefEmbed = null;
                    this.blockRefNewLine = null;
                    this.originalText = null;
                    this.blockRefDragState = null;
                    this.blockRefStartLeaf = null;
                    this.blockRefClientY = null;
                    this.blockRefModDrop = { alt: null, ctrl: null, shift: null }
                    this.blockRefModDrag = { alt: null, ctrl: null, shift: null }
                })
            }

            if (this.settings.autoSelect) {
                if ((evt.ctrlKey || evt.metaKey) && evt.shiftKey) {
                    let leafEl = this.app.workspace.containerEl.find(".workspace-leaf:hover");

                    let allLeaves: Array<WorkspaceLeaf> = this.app.workspace.getLeavesOfType("markdown");
                    let hoveredLeaf: WorkspaceLeaf = allLeaves.find(eachLeaf => eachLeaf.containerEl == leafEl);
                    let mdView: MarkdownView;
                    if (hoveredLeaf) { mdView = hoveredLeaf.view as MarkdownView; }
                    if (mdView) {
                        let mdEditor: Editor = mdView.editor;
                        let topPos: number = evt.clientY + 1;
                        //NOTE: mdEditor.posAtCoords(x, y) is equivalent to mdEditor.cm.coordsChar({ left: x, top: y })
                        let thisLine: number = mdEditor.posAtCoords(0, topPos).line;
                        mdEditor.setSelection({ line: thisLine, ch: 0 }, { line: thisLine, ch: 9999 });
                    }
                }
            }
        });

        this.registerDomEvent(actDoc, 'drop', async (evt: DragEvent) => {
            if (this.blockRefDragState === 'start') {
                this.blockRefDragState = 'dropped';
                this.blockRefModDrop = { alt: evt.altKey, ctrl: (evt.ctrlKey || evt.metaKey), shift: evt.shiftKey }

                //Find the active leaf view which just got text dropped into it
                let mdView: MarkdownView = this.app.workspace.getActiveViewOfType(MarkdownView);
                if (mdView) {
                    let mdEditor: Editor = mdView.editor;
                    let selectedText: string = mdEditor.getSelection();
                    let topPos: number = evt.clientY + 1;
                    let thisLine: number = mdEditor.posAtCoords(0, topPos).line;
                    let lineContent: string = mdEditor.getLine(thisLine);
                    let extraLines: number = 0;

                    //If header or block reference was dropped onto the same page then remove the file name from the reference
                    if (this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && !this.blockRefModDrag.shift) {
                        let startView: MarkdownView = this.blockRefStartLeaf.view as MarkdownView;
                        if (mdView.file.basename === startView.file.basename) {
                            lineContent = lineContent.replace(mdView.file.basename, '');
                            mdEditor.setLine(thisLine, lineContent);
                            mdEditor.setSelection({ line: thisLine + 1, ch: 0 }, { line: thisLine + 1, ch: 9999 });
                        }
                    }

                    //Add extra line breaks based on what modifier keys you hold on drop
                    if ((this.blockRefModDrag.alt && (this.blockRefModDrop.ctrl || this.blockRefModDrop.shift))
                        || (this.blockRefModDrag.shift && (this.blockRefModDrop.ctrl || this.blockRefModDrop.alt))
                        || (this.blockRefModDrag.ctrl && (this.blockRefModDrop.alt || this.blockRefModDrop.shift))
                        || (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && !this.blockRefModDrag.shift
                            && (this.blockRefModDrop.alt || this.blockRefModDrop.shift || this.blockRefModDrop.ctrl))) {
                        //Move
                        if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && !this.blockRefModDrag.shift) {
                            //If you also hold shift on drop with alt then add a line break above and below
                            if (this.blockRefModDrop.alt) {
                                if (this.blockRefModDrop.shift) {
                                    lineContent = lineContent.replace(selectedText, `\n${selectedText}\n`);
                                    extraLines = 2;
                                } else {
                                    lineContent = lineContent.replace(selectedText, `\n${selectedText}`);
                                    extraLines = 1;
                                }
                            }
                        }

                        //Copy
                        if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && this.blockRefModDrag.shift) {
                            //If you also hold ctrl on drop with alt then add a line break above and below
                            if (this.blockRefModDrop.alt) {
                                if (this.blockRefModDrop.ctrl) {
                                    lineContent = lineContent.replace(selectedText, `\n${selectedText}\n`);
                                    extraLines = 2;
                                } else {
                                    lineContent = lineContent.replace(selectedText, `\n${selectedText}`);
                                    extraLines = 1;
                                }
                            }
                        }

                        //Block Reference
                        if (this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && !this.blockRefModDrag.shift) {
                            //If you also hold ctrl on drop with shift then add a line break above and below
                            if (this.blockRefModDrop.shift) {
                                if (this.blockRefModDrop.ctrl) {
                                    lineContent = lineContent.replace(selectedText, `\n${selectedText}\n`);
                                    extraLines = 2;
                                } else {
                                    lineContent = lineContent.replace(selectedText, `\n${selectedText}`);
                                    extraLines = 1;
                                }
                            }
                        }

                        mdEditor.setLine(thisLine, lineContent);
                        mdEditor.setSelection({ line: thisLine + 1, ch: 0 }, { line: thisLine + 1, ch: 9999 });

                        //Need to increment the original line variable by 1 because you added an extra line with \n in the same file/leaf/view/pane
                        if (this.blockRefStartLine > thisLine && this.blockRefStartLeaf === mdView.leaf) { this.blockRefStartLine = this.blockRefStartLine + extraLines; }
                    }
                }

                //this.app.workspace.setActiveLeaf(this.blockRefStartLeaf);
                let mdView2: MarkdownView;
                if (this.blockRefStartLeaf) { mdView2 = this.blockRefStartLeaf.view as MarkdownView; }
                if (mdView2) {
                    let mdEditor2: Editor = mdView2.editor;

                    //No modifier keys held so move the block to the new location
                    if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && !this.blockRefModDrag.shift) {
                        //Delete the original line you dragged by setting it and the next line to the next line text
                        let nextLine: string = mdEditor2.getLine(this.blockRefStartLine + 1);
                        mdEditor2.replaceRange(nextLine, { line: this.blockRefStartLine, ch: 0 }, { line: this.blockRefStartLine + 1, ch: 9999 })
                    }

                    //Shift key held so copy the block to the new location
                    if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && this.blockRefModDrag.shift) {
                        //Do not have to do anything to the original block you dragged because it is just a copy / duplicate command
                    }

                    //Alt key held to create a block reference (CMD/Ctrl is not working for MACs so going with Alt)
                    if ((this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && !this.blockRefModDrag.shift)
                        || (this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && this.blockRefModDrag.shift)) {
                        if (this.blockRefNewLine !== this.originalText) { mdEditor2.setLine(this.blockRefStartLine, this.blockRefNewLine); }
                        mdEditor2.setSelection({ line: this.blockRefStartLine, ch: 0 }, { line: this.blockRefStartLine, ch: 9999 });
                    }
                }
            }

            if (this.searchResDragType === 'ref') {
                //Check if a header ref in which case do not have to create a block reference in the source file
                if (this.searchResContent !== this.searchResNewBlockRef) {
                    let fileCont = await this.app.vault.read(this.searchResFile);
                    let checkString = getStringFromFilePosition(fileCont, this.searchResLocation);
                    if (checkString === this.searchResContent) {
                        let newFileCont = replaceStringInFile(fileCont, this.searchResLocation, this.searchResNewBlockRef);
                        await this.app.vault.modify(this.searchResFile, newFileCont);
                    }
                } else {
                    //console.log('search result HEADER ref');
                }
            }
        })

        this.registerDomEvent(actDoc, 'mouseleave', (evt: MouseEvent) => {
            const oldElem: HTMLElement = document.getElementById('block-ref-hover');
            if (oldElem) { oldElem.style.color = "transparent"; }
        })
    }

    onLayoutChange(): void {
        let oldElem = document.getElementById('block-ref-hover');
        if (oldElem) { oldElem.remove() }
        oldElem = document.getElementById('search-res-hover');
        if (oldElem) { oldElem.remove() }
    }

    onFileChange(): void {
        let oldElem = document.getElementById('block-ref-hover');
        if (oldElem) { oldElem.remove() }
        oldElem = document.getElementById('search-res-hover');
        if (oldElem) { oldElem.remove() }
    }

    onunload() {
        let oldElem = document.getElementById('block-ref-hover');
        if (oldElem) { oldElem.remove() }
        oldElem = document.getElementById('search-res-hover');
        if (oldElem) { oldElem.remove() }
        console.log("Unloading plugin: " + pluginName);
	}

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

    async saveSettings() {
        await this.saveData(this.settings);
	}
}

class SampleSettingTab extends PluginSettingTab {
	plugin: MyPlugin;

	constructor(app: App, plugin: MyPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
        let { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'Drag and Drop Block Settings' });

        new Setting(containerEl)
            .setName('Use !Embed for Block References')
            .setDesc('Enable to ![[Embed]] the reference, otherwise will only create [[links]]')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.embed)
                .onChange(async (value) => {
                    this.plugin.settings.embed = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Alias Text')
            .setDesc('`Alt/Option` + `Shift` + Drag copies the text and adds an aliased block reference')
            .addText(text => text
                .setPlaceholder('source')
                .setValue(this.plugin.settings.aliasText)
                .onChange(async (value) => {
                    this.plugin.settings.aliasText = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Auto Select Line')
            .setDesc('Holding `Ctrl/CMD` + `Shift` will select the line your mouse is hovering over')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSelect)
                .onChange(async (value) => {
                    this.plugin.settings.autoSelect = value;
                    await this.plugin.saveSettings();
                }));
	}
}

function getPositionFromLine(fileContent: string, line: number, startAtZero: boolean = false) {
    let resultPos: { start: charPos, end: charPos };
    let charCtr: number = 0;
    let lineCtr: number;
    if (startAtZero) { lineCtr = 0 } else { lineCtr = 1 }
    let foundLine: boolean = false;
    for (const eachLine of fileContent.split('\n')) {
        if (!foundLine) {
            if (lineCtr === line) {
                foundLine = true;
                resultPos = { start: charCtr, end: charCtr + eachLine.length }
            } else {
                charCtr += eachLine.length + 1;
            }
            lineCtr++;
        }
    }
    return resultPos;
}

function getStringFromFilePosition(fileContent: string, charPosition: { start: charPos, end: charPos }) {
    let str: string = fileContent.substring(charPosition.start, charPosition.end);
    return str;
}

function replaceStringInFile(fileContent: string, charPosition: { start: charPos, end: charPos }, replaceWith: string) {
    let before = fileContent.substring(0, charPosition.start);
    let after = fileContent.substring(charPosition.end);
    let target = fileContent.substring(charPosition.start, charPosition.end);
    //console.log('Replaced "' + target + '" with "' + replaceWith + '"');
    return before + replaceWith + after;
}