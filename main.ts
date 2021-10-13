import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, MarkdownView, Editor, CachedMetadata, setIcon, HeadingCache, ListItemCache, SectionCache } from 'obsidian';
import { charPos, SearchLeaf, SearchView } from "./types"

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

    //Variables for DOM elements listening to
    elModLeftSplit: HTMLDivElement;
    elModRoot: HTMLDivElement;

    //Markdown edit view variables
    docBody: HTMLBodyElement;
    blockRefHandle: HTMLDivElement;
    blockRefSource: {
        leaf: WorkspaceLeaf,
        file: TFile,
        lnDragged: number,
        lnStart: number,
        lnEnd: number
    }
    blockRefEmbed: string;
    blockRefNewLine: string;
    originalText: string;
    blockRefDragState: string;
    blockRefDragType: string;
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
    //Variables for Search results dragging
    searchResDiv: HTMLDivElement;
    searchResHandle: HTMLDivElement;
    searchResLink: string;
    searchResContent: string;
    searchResNewBlockRef: string;
    searchResDragType: string;
    searchResDragState: string;
    searchResLocation: { start: charPos, end: charPos }
    searchResFile: TFile;
    searchResGhost: HTMLDivElement;

	async onload() {
        console.log("loading plugin: " + pluginName);

        this.elModLeftSplit = null;
        this.elModRoot = null;

        await this.loadSettings();
        this.addSettingTab(new SampleSettingTab(this.app, this));
        this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));
        //Primarily for switching between panes or opening a new file
        this.registerEvent(this.app.workspace.on('file-open', this.onFileChange.bind(this)));
        //Primarily for when switching between Edit and Preview mode
        this.registerEvent(this.app.workspace.on('layout-change', this.onLayoutChange.bind(this)));
    }

    onLayoutReady(): void {
        setTimeout(() => {
            this.docBody = document.querySelector("body");
            //For regular markdown edit view
            clearMarkdownVariables(this.app, this);
            //For search
            clearSearchVariables(this.app, this);
            setupEventListeners(this.app, this);
        }, 5000);
    }

    onLayoutChange(): void {
        if (this.docBody) {
            //For regular markdown edit view
            clearMarkdownVariables(this.app, this);
            //For search
            clearSearchVariables(this.app, this);
            //In case workspace changes need to see if necessary to re-setup the event listeners. This function will first check if necessary to re-create
            setupEventListeners(this.app, this);
        }
    }

    onFileChange(): void {
        //Not clearing here because unsure if this triggers when dragging from one file to the next and could clear a variable that is needed

        //For regular markdown edit view
        //clearMarkdownVariables(this.app, this);
        //For search
        //clearSearchVariables(this.app, this);
    }

    onunload() {
        //For regular markdown edit view
        clearMarkdownVariables(this.app, this);
        //For search
        clearSearchVariables(this.app, this);
        //Cleanup HTML elements for garbage collection
        cleanupElements(this.app, this);

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

function setupSearchDragStart(thisApp: App, thisPlugin: MyPlugin, mainDiv: HTMLDivElement) {
    //Setup custom "ghost" image element to follow the mouse drag like the native obsidian search result drag link dow
    const dragGhost = thisPlugin.searchResGhost;
    const dragGhostSelfSpan = dragGhost.querySelector('span');
    const dragGhostAction = dragGhost.querySelector('.drag-ghost-action');
    const dragGhostSelf = dragGhost.querySelector('.drag-ghost-self');

    //Find the actual line based off iterating through the search view result dom
    const searchLeaf: SearchLeaf = thisApp.workspace.getLeavesOfType("search")[0] as SearchLeaf;
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
                    let mdCache: CachedMetadata = thisApp.metadataCache.getFileCache(searchFile);
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
                                        //This was confirmed by Licat and he agrees it is kind of odd but the way the parser he uses does it
                                        //See conversation here: https://discord.com/channels/686053708261228577/840286264964022302/882329691002929192
                                        if ((eachList.position.start.offset - eachList.position.start.col) <= findStartPos && eachList.position.end.offset >= findStartPos) {
                                            if (!foundResult) {
                                                thisPlugin.searchResLocation = { start: (eachList.position.start.offset - eachList.position.start.col), end: eachList.position.end.offset };
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
                                                    thisPlugin.searchResLocation = { start: eachSection.position.start.offset, end: eachSection.position.end.offset };
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
            if (thisPlugin.settings.embed) { embedOrLink = '!' } else { embedOrLink = "" }
            let finalString: string;
            let blockid: string = "";
            let block: string;
            if (finalResult.startsWith('#')) {
                finalString = finalResult;
                blockid = finalResult.replace(/(\[|\]|#|\*|\(|\)|:|,)/g, "").replace(/(\||\.)/g, " ").trim();
                block = `${embedOrLink}[` + `[${fileName}#${blockid}]]`;
            } else {
                const blockRef: RegExpMatchArray = finalResult.match(/(^| )\^([^\s\n]+)$/);
                if (blockRef) {
                    blockid = blockRef[2];
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
            thisPlugin.searchResLink = block;
            thisPlugin.searchResContent = finalResult;
            thisPlugin.searchResNewBlockRef = finalString;
            thisPlugin.searchResFile = searchFile;

            dragGhostSelfSpan.setText(fileName);
            dragGhostAction.setText(finalResult.trim());
        }
    }
}

function setupBlockDragStart(thisApp: App, thisPlugin: MyPlugin, evt: DragEvent) {
    let hoveredLeaf: WorkspaceLeaf = thisPlugin.blockRefSource.leaf;
    let mdView: MarkdownView;
    if (hoveredLeaf) { mdView = hoveredLeaf.view as MarkdownView; }
    if (mdView) {
        //Setup custom "ghost" image element to follow the mouse drag like the native obsidian search result drag link does
        const dragGhost = thisPlugin.searchResGhost;
        const dragGhostSelfSpan = dragGhost.querySelector('span');
        const dragGhostAction = dragGhost.querySelector('.drag-ghost-action');
        const dragGhostSelf = dragGhost.querySelector('.drag-ghost-self');
        thisPlugin.docBody.appendChild(dragGhost);

        thisPlugin.blockRefSource.file = mdView.file;
        thisPlugin.blockRefModDrag = { alt: evt.altKey, ctrl: (evt.ctrlKey || evt.metaKey), shift: evt.shiftKey }
        let mdEditor: Editor = mdView.editor;
        let topPos: number = thisPlugin.blockRefClientY;
        //NOTE: mdEditor.posAtCoords(x, y) is equivalent to mdEditor.cm.coordsChar({ left: x, top: y })
        let thisLine: number = mdEditor.posAtCoords(0, topPos).line;
        thisPlugin.blockRefSource.lnDragged = thisLine;
        //selectEntireLine(mdEditor, thisLine, thisLine)
        let lineContent: string = mdEditor.getLine(thisLine);

        let blockid: string = '';
        let finalString: string = '';
        let block: string = '';

        //Check to see what type of block
        let blockTypeObj: { type: string, start: number, end: number } = findBlockTypeByLine(thisApp, mdView.file, thisLine);
        let blockType: string = blockTypeObj.type;
        thisPlugin.blockRefSource.lnStart = blockTypeObj.start;
        thisPlugin.blockRefSource.lnEnd = blockTypeObj.end;

        //Check to see if it is a Header line
        if (lineContent.startsWith('#') && !thisPlugin.blockRefModDrag.alt) {
            let mdCache: CachedMetadata = thisApp.metadataCache.getFileCache(mdView.file);
            let cacheHeaders: HeadingCache[] = mdCache.headings;
            let startLevel: number;
            let theEnd = false;
            let lineExtended: number;
            cacheHeaders.forEach(eachHeader => {
                if (!theEnd) {
                    let lineNumber = eachHeader.position.start.line;
                    let headerLvl = eachHeader.level;
                    if (lineNumber === thisLine) {
                        startLevel = headerLvl;
                    } else {
                        if (startLevel) {
                            if (headerLvl > startLevel) {

                            } else {
                                theEnd = true;
                                lineExtended = lineNumber - 1;
                            }
                        }
                    }
                }
            })
            if (!theEnd) { lineExtended = mdEditor.lastLine() }
            selectEntireLine(mdEditor, thisLine, lineExtended);
            thisPlugin.blockRefSource.lnStart = thisLine;
            thisPlugin.blockRefSource.lnEnd = lineExtended;
            lineContent = mdEditor.getSelection();
            evt.dataTransfer.setData("text/plain", lineContent);

            //Copy
            if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && thisPlugin.blockRefModDrag.shift) {
                thisPlugin.blockRefDragType = "copy-header";
            }
            //Move
            if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.shift) {
                thisPlugin.blockRefDragType = "move-header";
            }
        }

        //Check to see if it is a code block
        if (blockType === 'code' && !thisPlugin.blockRefModDrag.alt) {
            selectEntireLine(mdEditor, blockTypeObj.start, blockTypeObj.end);
            thisPlugin.blockRefSource.lnStart = blockTypeObj.start;
            thisPlugin.blockRefSource.lnEnd = blockTypeObj.end;
            lineContent = mdEditor.getSelection();
            evt.dataTransfer.setData("text/plain", lineContent);

            //Copy
            if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && thisPlugin.blockRefModDrag.shift) {
                thisPlugin.blockRefDragType = "copy-code";
            }
            //Move
            if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.shift) {
                thisPlugin.blockRefDragType = "move-code";
            }
        }

        //No modifier keys held so move the block to the new location
        if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.shift) {
            //Check to see if it is a Header line
            if (lineContent.startsWith('#') || blockType === 'code') {

            } else {
                evt.dataTransfer.setData("text/plain", lineContent.trim());
                //Just moving a single line
                thisPlugin.blockRefSource.lnStart = thisPlugin.blockRefSource.lnDragged;
                thisPlugin.blockRefSource.lnEnd = thisPlugin.blockRefSource.lnDragged;
            }
        }

        //Shift key held so copy the block to the new location
        if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && thisPlugin.blockRefModDrag.shift) {
            //Check to see if it is a Header line
            if (lineContent.startsWith('#') || blockType === 'code') {

            } else {
                evt.dataTransfer.setData("text/plain", lineContent.trim());
            }
        }

        //Alt key held to create a block/header reference (CMD/Ctrl is not working for MACs so going with Alt)
        if ((thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.shift)
            || (thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.ctrl && thisPlugin.blockRefModDrag.shift)) {
            let embedOrLink: string;
            if (thisPlugin.settings.embed) { embedOrLink = '!' } else { embedOrLink = "" }
            //Check if header reference instead of block
            if (lineContent.startsWith('#')) {
                finalString = lineContent;
                blockid = lineContent.replace(/(\[|\]|#|\*|\(|\)|:|,)/g, "").replace(/(\||\.)/g, " ").trim();
                block = `${embedOrLink}[` + `[${mdView.file.basename}#${blockid}]]`;
            } else {
                //If a list, skip the logic for checking if a multi line markdown block
                if (blockType === 'list') {
                    //console.log('this is a list item');
                    thisPlugin.blockRefSource.lnStart = thisPlugin.blockRefSource.lnDragged;
                    thisPlugin.blockRefSource.lnEnd = thisPlugin.blockRefSource.lnDragged;
                    thisPlugin.blockRefDragType = "ref-list";
                } else if (blockType === 'code') {
                    //console.log('this is a code block');
                    let endOfBlock: string = mdEditor.getLine(blockTypeObj.end + 1);
                    if (endOfBlock.startsWith('^')) {
                        //Already a block ref
                        lineContent = endOfBlock;
                    } else {
                        lineContent = "";
                    }
                    thisPlugin.blockRefSource.lnEnd = blockTypeObj.end;
                    thisPlugin.blockRefDragType = "ref-code";
                } else if (thisLine !== mdEditor.lastLine() && blockType === 'paragraph') { //Regular markdown line/section, check if it is a multi line block
                    let loopContinue = true;
                    let ctr = thisLine;
                    while (loopContinue) {
                        ctr++
                        if (ctr >= 999) { console.log(`[${pluginName}]: infinite loop caught`); break; }
                        if (mdEditor.getLine(ctr) === '' || mdEditor.lastLine() <= ctr) { loopContinue = false; }
                    }
                    if (mdEditor.lastLine() === ctr && mdEditor.getLine(ctr) !== '') { thisPlugin.blockRefSource.lnEnd = ctr } else { thisPlugin.blockRefSource.lnEnd = ctr - 1 }
                    lineContent = mdEditor.getLine(thisPlugin.blockRefSource.lnEnd);
                }

                const blockRef: RegExpMatchArray = lineContent.match(/(^| )\^([^\s\n]+)$/);
                if (blockRef) {
                    blockid = blockRef[2];
                    finalString = lineContent;
                } else {
                    let characters: string = 'abcdefghijklmnopqrstuvwxyz0123456789';
                    let charactersLength: number = characters.length;
                    for (var i = 0; i < 7; i++) {
                        blockid += characters.charAt(Math.floor(Math.random() * charactersLength));
                    }
                    finalString = lineContent + ` ^${blockid}`;
                    //Cannot trim a list item because it will remove its indentations
                    if (blockType !== 'list') { finalString = finalString.trim(); }
                }
                block = `${embedOrLink}[` + `[${mdView.file.basename}#^${blockid}]]`;
            }

            //Text + Alias block ref
            if (thisPlugin.blockRefModDrag.shift) {
                if (lineContent.startsWith('#')) {
                    finalString = lineContent;
                    block = `[` + `[${mdView.file.basename}#${blockid}|${thisPlugin.settings.aliasText}]]`;
                    block = lineContent.replace(/^#* /g, '') + ' ' + block;
                } else {
                    block = `[` + `[${mdView.file.basename}#^${blockid}|${thisPlugin.settings.aliasText}]]`;
                    block = lineContent.replace(/ \^.*$/, '') + ' ' + block;
                }
            }

            evt.dataTransfer.setData("text/plain", block);
        }

        thisPlugin.blockRefEmbed = block;
        thisPlugin.blockRefNewLine = finalString;
        thisPlugin.originalText = lineContent;

        dragGhostSelfSpan.setText(thisPlugin.blockRefSource.file.basename);
        dragGhostAction.setText(evt.dataTransfer.getData("text/plain").trim());
    }
}

function selectEntireLine(mdEditor: Editor, startLine: number, endLine: number) {
    const lnLength = mdEditor.getLine(endLine).length;
    mdEditor.setSelection({ line: startLine, ch: 0 }, { line: endLine, ch: lnLength });
}

function findHoveredLeaf(thisApp: App) {
    //Find the leaf that is being hovered over
    let leafEl = thisApp.workspace.containerEl.find(".workspace-leaf:hover");
    let allLeaves: Array<WorkspaceLeaf> = thisApp.workspace.getLeavesOfType("markdown");
    let hoveredLeaf: WorkspaceLeaf = allLeaves.find(eachLeaf => eachLeaf.containerEl == leafEl);
    return hoveredLeaf;
}

function clearMarkdownVariables(thisApp: App, thisPlugin: MyPlugin) {
    console.log(`[${pluginName}]: clearMarkdownVariables`);
    //thisPlugin.blockRefHandle = null;
    thisPlugin.blockRefEmbed = null;
    thisPlugin.blockRefNewLine = null;
    thisPlugin.originalText = null;
    thisPlugin.blockRefDragState = null;
    thisPlugin.blockRefDragType = null;
    thisPlugin.blockRefClientY = null;
    thisPlugin.blockRefSource = { leaf: null, file: null, lnDragged: null, lnStart: null, lnEnd: null }
    thisPlugin.blockRefModDrop = { alt: null, ctrl: null, shift: null }
    thisPlugin.blockRefModDrag = { alt: null, ctrl: null, shift: null }
    const dragGhost = thisPlugin.searchResGhost;
    if (dragGhost) { dragGhost.remove(); }
}

function clearSearchVariables(thisApp: App, thisPlugin: MyPlugin) {
    console.log(`[${pluginName}]: clearSearchVariables`);
    thisPlugin.searchResDiv = null;
    //thisPlugin.searchResHandle = null;
    thisPlugin.searchResLink = null;
    thisPlugin.searchResContent = null;
    thisPlugin.searchResNewBlockRef = null;
    thisPlugin.searchResDragType = null;
    thisPlugin.searchResDragState = null;
    thisPlugin.searchResLocation = { start: null, end: null }
    thisPlugin.searchResFile = null;
    //thisPlugin.searchResGhost = null;
    const dragGhost = thisPlugin.searchResGhost;
    if (dragGhost) { dragGhost.remove(); }
}

function findBlockTypeByLine(thisApp: App, file: TFile, lineNumber: number) {
    let mdCache: CachedMetadata = thisApp.metadataCache.getFileCache(file);
    let cacheSections: SectionCache[] = mdCache.sections;
    let blockType: string;
    let startLn: number;
    let endLn: number;
    if (cacheSections) {
        let foundItemMatch = cacheSections.find(eachSection => { if (eachSection.position.start.line <= lineNumber && eachSection.position.end.line >= lineNumber) { return true } else { return false } })
        if (foundItemMatch) {
            blockType = foundItemMatch.type;
            startLn = foundItemMatch.position.start.line;
            endLn = foundItemMatch.position.end.line;
        }
    }
    return { type: blockType, start: startLn, end: endLn };
}

function cleanupElements(thisApp: App, thisPlugin: MyPlugin) {
    //Cleanup all references of my HTML elements and event listeners
    console.log(`[${pluginName}]: cleanupElements (should only run on unload of plugin)`);
    clearMarkdownVariables(thisApp, thisPlugin);
    clearSearchVariables(thisApp, thisPlugin);

    thisPlugin.searchResDiv = null;

    let oldElem: HTMLElement = document.getElementById('search-res-hover');
    if (oldElem) { oldElem.remove() }
    if (oldElem) { oldElem.detach() }
    if (oldElem) { oldElem = null }
    thisPlugin.searchResHandle = null;

    oldElem = document.getElementById('search-res-ghost');
    if (oldElem) { oldElem.remove() }
    if (oldElem) { oldElem.detach() }
    if (oldElem) { oldElem = null }
    thisPlugin.searchResGhost = null;

    oldElem = document.getElementById('block-ref-hover');
    if (oldElem) { oldElem.remove() }
    if (oldElem) { oldElem.detach() }
    if (oldElem) { oldElem = null }
    thisPlugin.blockRefHandle = null;

    thisPlugin.docBody = null;
}

function createBodyElements(thisApp: App, thisPlugin: MyPlugin) {
    if (thisPlugin.docBody) {
        let setupSearchElem: boolean;
        if (thisPlugin.searchResHandle) {
            if (thisPlugin.searchResHandle.parentElement === null) {
                setupSearchElem = true;
                thisPlugin.searchResHandle.remove();
                thisPlugin.searchResHandle.detach();
                thisPlugin.searchResHandle = null;
            } else {
                setupSearchElem = false;
            }
        } else {
            setupSearchElem = true;
        }

        if (setupSearchElem) {
            console.log(`[${pluginName}]: Setting up the Search Drag Handler element`);
            const searchElement: HTMLDivElement = thisPlugin.docBody.createEl('div');
            searchElement.id = 'search-res-hover';
            thisPlugin.searchResHandle = searchElement;
            searchElement.draggable = true;
            searchElement.innerText = "⋮⋮";

            searchElement.addEventListener('mouseenter', (evt: MouseEvent) => {
                const eventDiv: HTMLDivElement = evt.target as HTMLDivElement;
                if (eventDiv) { eventDiv.className = 'show'; }
            })

            searchElement.addEventListener('mouseleave', (evt: MouseEvent) => {
                const eventDiv: HTMLDivElement = evt.target as HTMLDivElement;
                if (eventDiv) { eventDiv.className = 'hide'; }
            })

            searchElement.addEventListener('dragstart', (evt: DragEvent) => {
                const eventDiv: HTMLDivElement = evt.target as HTMLDivElement;
                thisPlugin.docBody.appendChild(thisPlugin.searchResGhost);
                thisPlugin.searchResDragState = 'dragstart';
                setupSearchDragStart(thisApp, thisPlugin, thisPlugin.searchResDiv);

                //Hide the :: drag handle as going to use a custom element as the "ghost image"
                if (eventDiv) {
                    eventDiv.className = 'hide';
                    evt.dataTransfer.setDragImage(eventDiv, 0, 0);

                    if (evt.altKey) {
                        thisPlugin.searchResDragType = 'ref';
                        evt.dataTransfer.setData("text/plain", thisPlugin.searchResLink);
                    }
                    if (evt.shiftKey || (!evt.shiftKey && !evt.altKey && !evt.ctrlKey && !evt.metaKey)) {
                        thisPlugin.searchResDragType = 'copy';
                        evt.dataTransfer.setData("text/plain", thisPlugin.searchResContent);
                    }
                }
            })

            searchElement.addEventListener('drag', (evt: DragEvent) => {
                //The custom drag element needs to "follow" the mouse move / drag and update its position
                const dragGhost: HTMLDivElement = thisPlugin.searchResGhost;
                if (dragGhost) {
                    dragGhost.style.left = `${evt.pageX + 10}px`;
                    dragGhost.style.top = `${evt.pageY + -30}px`;
                }
            })

            searchElement.addEventListener('dragend', (evt: DragEvent) => {
                if (thisPlugin.searchResDragState === 'dragstart') { clearSearchVariables(thisApp, thisPlugin); }
            })
        }

        let setupDragGhostElem: boolean = true;
        if (thisPlugin.searchResGhost) { setupDragGhostElem = false; }

        if (setupDragGhostElem) {
            console.log(`[${pluginName}]: Setting up the Drag Ghost element`);
            //Create a custom "ghost" image element to follow the mouse drag like the native obsidian search result drag link dow
            const dragGhost = thisPlugin.docBody.createEl('div', { text: '' });
            thisPlugin.searchResGhost = dragGhost;
            dragGhost.id = 'search-res-ghost';
            dragGhost.addClass('drag-ghost');

            const dragGhostSelf = dragGhost.createEl('div', { text: '' });
            dragGhostSelf.addClass('drag-ghost-self');
            setIcon(dragGhostSelf, "document");

            const dragGhostSelfSpan = dragGhostSelf.createEl('span', { text: '' });

            const dragGhostAction = dragGhost.createEl('div', { text: '' });
            dragGhostAction.addClass('drag-ghost-action');

            //Removing from DOM but it still sticks around in the background and then i re-append it to body when needed
            thisPlugin.searchResGhost.remove();
        }

        let setupBlockHandle: boolean;
        if (thisPlugin.blockRefHandle) {
            if (thisPlugin.blockRefHandle.parentElement === null) {
                setupBlockHandle = true;
                thisPlugin.blockRefHandle.remove();
                thisPlugin.blockRefHandle.detach();
                thisPlugin.blockRefHandle = null;
            } else {
                setupBlockHandle = false;
            }
        } else {
            setupBlockHandle = true;
        }

        if (setupBlockHandle) {
            console.log(`[${pluginName}]: Setting up the Block Drag Handler element`);
            const blockElement: HTMLDivElement = thisPlugin.docBody.createEl('div');
            blockElement.id = 'block-ref-hover';
            thisPlugin.blockRefHandle = blockElement;
            blockElement.draggable = true;
            blockElement.innerText = "⋮⋮";

            blockElement.addEventListener('mouseenter', (evt: MouseEvent) => {
                const eventDiv: HTMLDivElement = evt.target as HTMLDivElement;
                if (eventDiv) { eventDiv.className = 'show'; }
            })

            blockElement.addEventListener('mouseleave', (evt: MouseEvent) => {
                const eventDiv: HTMLDivElement = evt.target as HTMLDivElement;
                if (eventDiv) { eventDiv.className = 'hide'; }
            })

            blockElement.addEventListener('dragstart', (evt: DragEvent) => {
                thisPlugin.blockRefDragState = 'dragstart';
                setupBlockDragStart(thisApp, thisPlugin, evt);
            })

            blockElement.addEventListener('drag', (evt: DragEvent) => {
                //The custom drag element needs to "follow" the mouse move / drag and update its position
                const dragGhost: HTMLDivElement = thisPlugin.searchResGhost;
                if (dragGhost) {
                    dragGhost.style.left = `${evt.pageX + 10}px`;
                    dragGhost.style.top = `${evt.pageY + -30}px`;
                }
            })

            blockElement.addEventListener('dragend', (evt: DragEvent) => {
                if (thisPlugin.blockRefDragState === 'dragstart') { clearMarkdownVariables(thisApp, thisPlugin); }
            })
        }
    } else {
        console.log(`[${pluginName}]: No document body variable set`);
        thisPlugin.docBody = document.querySelector("body");
    }
}

function setupEventListeners(thisApp: App, thisPlugin: MyPlugin) {
    console.log(`[${pluginName}]: setupEventListeners`);
    let setupModRootLeft: boolean;
    if (thisPlugin.elModLeftSplit) {
        if (thisPlugin.elModLeftSplit.parentElement === null) {
            //If element got detached from DOM due to e.g. workspace change, then element is still present but parentElement will be null
            setupModRootLeft = true;
        } else {
            setupModRootLeft = false;
        }
    } else {
        setupModRootLeft = true;
    }

    if (setupModRootLeft) {
        console.log(`[${pluginName}]: setupModRootLeft`);
        createBodyElements(thisApp, thisPlugin);
        //Find the main DIV that holds the left sidebar search pane
        const actDocSearch: HTMLDivElement = document.querySelector('.workspace-split.mod-horizontal.mod-left-split') as HTMLDivElement;
        thisPlugin.elModLeftSplit = actDocSearch;

        thisPlugin.registerDomEvent(actDocSearch, 'mouseover', (evt: MouseEvent) => {
            const mainDiv: HTMLDivElement = evt.target as HTMLDivElement;
            if (mainDiv.className === 'search-result-file-match') {
                let searchHandleElement: HTMLDivElement = thisPlugin.searchResHandle;
                searchHandleElement.className = 'show';
                thisPlugin.searchResDiv = mainDiv;
                let targetRect = mainDiv.getBoundingClientRect();
                searchHandleElement.style.top = `${targetRect.top + 5}px`;
                searchHandleElement.style.left = `${targetRect.left - 12}px`;
            }
        })

        thisPlugin.registerDomEvent(actDocSearch, 'mouseout', (evt: MouseEvent) => {
            const elem: HTMLElement = evt.target as HTMLElement;
            const elemClass: string = elem.className;
            if (elemClass === 'search-result-file-matches' || elemClass === 'search-result-container mod-global-search' || elemClass === 'workspace-leaf-resize-handle') {
                console.log(`[${pluginName}]: Search Mouse Out`);
                if (thisPlugin.searchResHandle) { thisPlugin.searchResHandle.className = 'hide'; }
            }
        })
    }

    let setupModRoot: boolean;
    if (thisPlugin.elModRoot) {
        if (thisPlugin.elModRoot.parentElement === null) {
            setupModRoot = true;
        } else {
            setupModRoot = false;
        }
    } else {
        setupModRoot = true;
    }

    if (setupModRoot) {
        console.log(`[${pluginName}]: setupModRoot`);
        createBodyElements(thisApp, thisPlugin);
        //Find the main DIV that holds all the markdown panes
        const actDoc: HTMLDivElement = document.querySelector('.workspace-split.mod-vertical.mod-root') as HTMLDivElement;
        thisPlugin.elModRoot = actDoc;

        thisPlugin.registerDomEvent(actDoc, 'mouseover', (evt: MouseEvent) => {
            const mainDiv: HTMLElement = evt.target as HTMLElement;
            if (mainDiv.className === 'CodeMirror-linenumber CodeMirror-gutter-elt') {
                let blockHandleElement: HTMLDivElement = thisPlugin.blockRefHandle;
                let targetRect = mainDiv.getBoundingClientRect();
                blockHandleElement.style.top = `${targetRect.top - 1}px`;
                blockHandleElement.style.left = `${targetRect.left - 8}px`;

                thisPlugin.registerDomEvent(mainDiv, 'mouseout', (evt: MouseEvent) => {
                    if (thisPlugin.blockRefHandle) { thisPlugin.blockRefHandle.className = 'hide'; }
                })

                //Find the leaf that is being hovered over
                let hoveredLeaf: WorkspaceLeaf = findHoveredLeaf(thisApp);
                if (hoveredLeaf) {
                    thisPlugin.blockRefSource.leaf = hoveredLeaf;
                    thisPlugin.blockRefClientY = evt.clientY;
                }
            }

            if (thisPlugin.settings.autoSelect) {
                if ((evt.ctrlKey || evt.metaKey) && evt.shiftKey) {
                    //Find the leaf that is being hovered over
                    let hoveredLeaf: WorkspaceLeaf = findHoveredLeaf(thisApp);
                    let mdView: MarkdownView;
                    if (hoveredLeaf) { mdView = hoveredLeaf.view as MarkdownView; }
                    if (mdView) {
                        let mdEditor: Editor = mdView.editor;
                        let topPos: number = evt.clientY;
                        //NOTE: mdEditor.posAtCoords(x, y) is equivalent to mdEditor.cm.coordsChar({ left: x, top: y })
                        let thisLine: number = mdEditor.posAtCoords(0, topPos).line;
                        selectEntireLine(mdEditor, thisLine, thisLine)
                    }
                }
            }
        });

        thisPlugin.registerDomEvent(actDoc, 'drop', async (evt: DragEvent) => {
            thisPlugin.searchResDragState = 'dropped';
            if (thisPlugin.blockRefDragState === 'dragstart') {
                thisPlugin.blockRefDragState = 'dropped';
                thisPlugin.blockRefModDrop = { alt: evt.altKey, ctrl: (evt.ctrlKey || evt.metaKey), shift: evt.shiftKey }

                //Find the active leaf view which just got text dropped into it
                let mdView: MarkdownView = thisApp.workspace.getActiveViewOfType(MarkdownView);
                let droppedLine: number;
                if (mdView) {
                    let mdEditor: Editor = mdView.editor;
                    let selectedText: string = mdEditor.getSelection();
                    let topPos: number = evt.clientY;
                    droppedLine = mdEditor.posAtCoords(0, topPos).line;
                    let extraLines: number = 0;

                    //If header or block reference was dropped onto the same page then remove the file name from the reference
                    if (thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.shift) {
                        let startView: MarkdownView = thisPlugin.blockRefSource.leaf.view as MarkdownView;
                        if (mdView === startView) {
                            selectedText = selectedText.replace(mdView.file.basename, '');
                        }
                    }

                    //Add extra line breaks based on what modifier keys you hold on drop
                    if ((thisPlugin.blockRefModDrag.alt && (thisPlugin.blockRefModDrop.ctrl || thisPlugin.blockRefModDrop.shift))
                        || (thisPlugin.blockRefModDrag.shift && (thisPlugin.blockRefModDrop.ctrl || thisPlugin.blockRefModDrop.alt))
                        || (thisPlugin.blockRefModDrag.ctrl && (thisPlugin.blockRefModDrop.alt || thisPlugin.blockRefModDrop.shift))
                        || (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.shift
                            && (thisPlugin.blockRefModDrop.alt || thisPlugin.blockRefModDrop.shift || thisPlugin.blockRefModDrop.ctrl))) {

                        //Move
                        if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.shift) {
                            //If you also hold shift on drop with alt then add a line break above and below
                            if (thisPlugin.blockRefModDrop.alt) {
                                if (thisPlugin.blockRefModDrop.shift) {
                                    selectedText = `\n${selectedText}\n`;
                                    extraLines = 2;
                                } else {
                                    selectedText = `\n${selectedText}`;
                                    extraLines = 1;
                                }
                            }
                        }

                        //Copy
                        if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && thisPlugin.blockRefModDrag.shift) {
                            //If you also hold ctrl on drop with alt then add a line break above and below
                            if (thisPlugin.blockRefModDrop.alt) {
                                if (thisPlugin.blockRefModDrop.ctrl) {
                                    selectedText = `\n${selectedText}\n`;
                                    extraLines = 2;
                                } else {
                                    selectedText = `\n${selectedText}`;
                                    extraLines = 1;
                                }
                            }
                        }

                        //Block Reference
                        if (thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.shift) {
                            //If you also hold ctrl on drop with shift then add a line break above and below
                            if (thisPlugin.blockRefModDrop.shift) {
                                if (thisPlugin.blockRefModDrop.ctrl) {
                                    selectedText = `\n${selectedText}\n`;
                                    extraLines = 2;
                                } else {
                                    selectedText = `\n${selectedText}`;
                                    extraLines = 1;
                                }
                            }
                        }

                        mdEditor.replaceSelection(selectedText);

                        //Need to increment the original line variable by 1 or 2 because you added an extra line (or two) with \n in the same file/leaf/view/pane
                        if (thisPlugin.blockRefSource.lnDragged > droppedLine && thisPlugin.blockRefSource.leaf === mdView.leaf) {
                            thisPlugin.blockRefSource.lnStart = thisPlugin.blockRefSource.lnStart + extraLines;
                            thisPlugin.blockRefSource.lnEnd = thisPlugin.blockRefSource.lnEnd + extraLines;
                            thisPlugin.blockRefSource.lnDragged = thisPlugin.blockRefSource.lnDragged + extraLines;
                        }
                    } else {
                        mdEditor.replaceSelection(selectedText);
                    }
                }

                //For the original source leaf that you dragged stuff FROM
                let mdView2: MarkdownView;
                if (thisPlugin.blockRefSource.leaf) { mdView2 = thisPlugin.blockRefSource.leaf.view as MarkdownView; }
                if (mdView2) {
                    let mdEditor2: Editor = mdView2.editor;
                    if (thisPlugin.blockRefSource.lnStart === null) { thisPlugin.blockRefSource.lnStart = thisPlugin.blockRefSource.lnDragged }
                    if (thisPlugin.blockRefSource.lnEnd === null) { thisPlugin.blockRefSource.lnEnd = thisPlugin.blockRefSource.lnDragged }

                    //No modifier keys held so move the block to the new location
                    if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.shift) {
                        //Delete the original line/section you dragged by setting it and the next line to the next line text
                        let startLine: number = thisPlugin.blockRefSource.lnStart;
                        let endLine: number = thisPlugin.blockRefSource.lnEnd;

                        if (mdView === mdView2 && startLine > droppedLine) {
                            //Length requires a +1 but because dragging to an existing line in file, it offsets that +1 with a -1
                            let blockLength: number = thisPlugin.blockRefSource.lnEnd - thisPlugin.blockRefSource.lnStart + 1 - 1;
                            startLine = thisPlugin.blockRefSource.lnStart + blockLength;
                            endLine = thisPlugin.blockRefSource.lnEnd + blockLength;
                        }

                        endLine = endLine + 1;
                        let stringToReplace: string = mdEditor2.getLine(endLine);

                        if (endLine > mdEditor2.lastLine()) {
                            endLine = mdEditor2.lastLine();
                            if (startLine > 0) {
                                startLine = startLine - 1;
                                stringToReplace = mdEditor2.getLine(startLine);
                            } else {
                                //rare circumstance that the moved line is the only one in the file
                                //so just set to blank and don't try to delete the line above or below
                                startLine = thisPlugin.blockRefSource.lnDragged;
                                endLine = startLine;
                                stringToReplace = "";
                            }
                        }

                        const endOfLine = mdEditor2.getLine(endLine).length;
                        mdEditor2.replaceRange(stringToReplace, { line: startLine, ch: 0 }, { line: endLine, ch: endOfLine })
                    }

                    //Shift key held so copy the block to the new location
                    if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && thisPlugin.blockRefModDrag.shift) {
                        //Do not have to do anything to the original block you dragged because it is just a copy / duplicate command
                    }

                    //Alt key held to create a block reference (CMD/Ctrl is not working for MACs so going with Alt)
                    if ((thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.shift)
                        || (thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.ctrl && thisPlugin.blockRefModDrag.shift)) {
                        if (thisPlugin.blockRefDragType === 'ref-code') {
                            let codeLastLine: string = mdEditor2.getLine(thisPlugin.blockRefSource.lnEnd);
                            let blockRefLine: string = mdEditor2.getLine(thisPlugin.blockRefSource.lnEnd + 1);
                            if (blockRefLine.startsWith('^')) {

                            } else if (blockRefLine === '') {
                                mdEditor2.setLine(thisPlugin.blockRefSource.lnEnd, `${codeLastLine}\n`);
                            } else {
                                mdEditor2.setLine(thisPlugin.blockRefSource.lnEnd, `${codeLastLine}\n\n`);
                            }

                            mdEditor2.setLine(thisPlugin.blockRefSource.lnEnd + 1, thisPlugin.blockRefNewLine);
                            selectEntireLine(mdEditor2, thisPlugin.blockRefSource.lnStart, thisPlugin.blockRefSource.lnEnd + 1)
                        } else {
                            if (thisPlugin.blockRefNewLine !== thisPlugin.originalText) { mdEditor2.setLine(thisPlugin.blockRefSource.lnEnd, thisPlugin.blockRefNewLine); }
                            selectEntireLine(mdEditor2, thisPlugin.blockRefSource.lnStart, thisPlugin.blockRefSource.lnEnd)
                        }
                    }
                }
            }

            //This is for dragged items from Search results that are to be block refs and is NOT a header
            if (thisPlugin.searchResDragType === 'ref') {
                //Check if a header ref in which case do NOT have to create a block reference in the source file
                if (thisPlugin.searchResContent !== thisPlugin.searchResNewBlockRef) {
                    let fileCont = await thisApp.vault.read(thisPlugin.searchResFile);
                    let checkString = getStringFromFilePosition(fileCont, thisPlugin.searchResLocation);
                    if (checkString === thisPlugin.searchResContent) {
                        let newFileCont = replaceStringInFile(fileCont, thisPlugin.searchResLocation, thisPlugin.searchResNewBlockRef);
                        await thisApp.vault.modify(thisPlugin.searchResFile, newFileCont);
                    }
                } else {
                    //console.log('search result HEADER ref');
                }
            }

            clearMarkdownVariables(thisApp, thisPlugin);
            clearSearchVariables(thisApp, thisPlugin);
        })

        thisPlugin.registerDomEvent(actDoc, 'mouseleave', (evt: MouseEvent) => {
            if (thisPlugin.blockRefHandle) { thisPlugin.blockRefHandle.className = 'hide'; }
        })
    }
}