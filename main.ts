import { App, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, MarkdownView, Editor, CachedMetadata, setIcon, HeadingCache, ListItemCache, SectionCache, EditorPosition, lineCoordinates } from 'obsidian';
import { charPos, SearchLeaf, SearchView } from "./types"

const pluginName = 'Drag and Drop Blocks';
const myConsoleLogs = true;

interface MyPluginSettings {
    embed: boolean;
    autoSelect: boolean;
    aliasText: string;
    dragOffset: string;
    dragFontSize: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
    embed: true,
    autoSelect: false,
    aliasText: 'source',
    dragOffset: '0',
    dragFontSize: '20px'
}

export default class MyPlugin extends Plugin {
    settings: MyPluginSettings;

    //Variables for DOM elements listening to
    elModLeftSplit: HTMLDivElement;
    elModRoot: HTMLDivElement;

    //Markdown edit view variables
    docBody: HTMLBodyElement;
    blockRefHandle: HTMLDivElement;
    dragZoneLine: HTMLHRElement;
    dragZoneLineObj: { mdEditor: Editor, edPos: EditorPosition, cmLnElem: HTMLElement }
    blockRefSource: {
        cmLnElem: HTMLPreElement,
        leaf: WorkspaceLeaf,
        file: TFile,
        lnDragged: number,
        lnStart: number,
        lnEnd: number,
        type: string
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
        if (document.querySelector("body")) {
            this.docBody = document.querySelector("body");
            //For regular markdown edit view
            clearMarkdownVariables(this.app, this);
            //For search
            clearSearchVariables(this.app, this);
            setupEventListeners(this.app, this);
        } else {
            setTimeout(() => {
                this.docBody = document.querySelector("body");
                //For regular markdown edit view
                clearMarkdownVariables(this.app, this);
                //For search
                clearSearchVariables(this.app, this);
                setupEventListeners(this.app, this);
            }, 5000);
        }
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
            .setName('Drag Handle Size')
            .setDesc(createFragment((innerFrag) => {
                innerFrag.createEl('span', { text: 'Font size for the drag handles (DEFAULT: 20px)' });
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Note:' });
                innerFrag.createEl('span', { text: ' Must restart Obsidian for changes to take effect' });
            }))
            .addText(text => text
                .setPlaceholder('20px')
                .setValue(this.plugin.settings.dragFontSize)
                .onChange(async (value) => {
                    let valToUse = value;
                    if (valToUse === "" || valToUse === "0" || !valToUse) { valToUse = `20px` }
                    if (parseInt(valToUse).toString() === valToUse) { valToUse = `${valToUse}px` }
                    this.plugin.settings.dragFontSize = valToUse;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Drag Handle Location Offset')
            .setDesc(createFragment((innerFrag) => {
                innerFrag.createEl('span', { text: 'Positive number moves the drag handles to the right (closer to text)' });
                innerFrag.createEl('br');
                innerFrag.createEl('span', { text: 'Negative moves to the left (closer to edge of Pane)' });
                innerFrag.createEl('br');
                innerFrag.createEl('strong', { text: 'Note:' });
                innerFrag.createEl('span', { text: ' Must restart Obsidian for changes to take effect' });
            }))
            .addText(text => text
                .setPlaceholder('0')
                .setValue(this.plugin.settings.dragOffset)
                .onChange(async (value) => {
                    let toNum: number = parseInt(value);
                    if (isNaN(toNum)) { toNum = 0 }
                    this.plugin.settings.dragOffset = toNum.toString();
                    await this.plugin.saveSettings();
                }));
        //containerEl.createEl('div', { text: '' })
        //containerEl.createEl('div', { text: '' })

        /*
        new Setting(containerEl)
            .setName('Auto Select Line')
            .setDesc('Holding `Ctrl/CMD` + `Shift` will select the line your mouse is hovering over')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.autoSelect)
                .onChange(async (value) => {
                    this.plugin.settings.autoSelect = value;
                    await this.plugin.saveSettings();
                }));
        */
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
    //writeConsoleLog('Replaced "' + target + '" with "' + replaceWith + '"')
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
        //Re-append the horizontal drag line
        thisPlugin.docBody.appendChild(thisPlugin.dragZoneLine);

        if (thisPlugin.blockRefSource.cmLnElem) { thisPlugin.blockRefSource.cmLnElem.id = `source-cm-line`; }

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
        thisPlugin.blockRefSource.type = blockType;

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

        //Check to see if it is a list item
        if (blockType === 'list' && !thisPlugin.blockRefModDrag.alt) {
            //writeConsoleLog(`list item with children`);
            //writeConsoleLog(blockTypeObj);
            selectEntireLine(mdEditor, blockTypeObj.start, blockTypeObj.end);
            thisPlugin.blockRefSource.lnStart = blockTypeObj.start;
            thisPlugin.blockRefSource.lnEnd = blockTypeObj.end;
            //writeConsoleLog(`${thisPlugin.blockRefSource.lnStart} - ${thisPlugin.blockRefSource.lnEnd} - ${thisPlugin.blockRefSource.lnDragged}`)
            lineContent = mdEditor.getSelection();
            evt.dataTransfer.setData("text/plain", lineContent);

            //Copy
            if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && thisPlugin.blockRefModDrag.shift) {
                thisPlugin.blockRefDragType = "copy-list";
            }
            //Move
            if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.shift) {
                thisPlugin.blockRefDragType = "move-list";
            }
        }

        //No modifier keys held so move the block to the new location
        if (!thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.shift) {
            //Check to see if it is a Header line
            if (lineContent.startsWith('#') || blockType === 'code' || blockType === 'list') {

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
            if (lineContent.startsWith('#') || blockType === 'code' || blockType === 'list') {

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
                    //writeConsoleLog(`this is a list item`);
                    thisPlugin.blockRefSource.lnStart = thisPlugin.blockRefSource.lnDragged;
                    thisPlugin.blockRefSource.lnEnd = thisPlugin.blockRefSource.lnDragged;
                    thisPlugin.blockRefDragType = "ref-list";
                } else if (blockType === 'code') {
                    //writeConsoleLog('this is a code block');
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
                        if (ctr >= 999) { console.log(`infinite loop caught`); break; }
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

function findHoveredLeaf(thisApp: App): WorkspaceLeaf {
    //Find the leaf that is being hovered over
    let leafEl = thisApp.workspace.containerEl.find(".workspace-leaf:hover");
    let allLeaves: Array<WorkspaceLeaf> = thisApp.workspace.getLeavesOfType("markdown");
    let hoveredLeaf: WorkspaceLeaf = allLeaves.find(eachLeaf => eachLeaf.containerEl == leafEl);
    return hoveredLeaf;
}

function findHoveredLeafByElement(thisApp: App, elem: HTMLElement): WorkspaceLeaf {
    //Find the leaf that is being hovered over
    let leafEl = elem.closest(".workspace-leaf");
    let allLeaves: Array<WorkspaceLeaf> = thisApp.workspace.getLeavesOfType("markdown");
    let hoveredLeaf: WorkspaceLeaf = allLeaves.find(eachLeaf => eachLeaf.containerEl == leafEl);
    return hoveredLeaf;
}

function clearMarkdownVariables(thisApp: App, thisPlugin: MyPlugin) {
    //writeConsoleLog(`clearMarkdownVariables`);
    //thisPlugin.blockRefHandle = null;
    thisPlugin.blockRefEmbed = null;
    thisPlugin.blockRefNewLine = null;
    thisPlugin.originalText = null;
    thisPlugin.blockRefDragState = null;
    thisPlugin.blockRefDragType = null;
    thisPlugin.blockRefClientY = null;
    if (thisPlugin.blockRefSource) {
        if (thisPlugin.blockRefSource.cmLnElem) { thisPlugin.blockRefSource.cmLnElem.id = ``; }
    }
    thisPlugin.blockRefSource = { cmLnElem: null, leaf: null, file: null, lnDragged: null, lnStart: null, lnEnd: null, type: null }
    thisPlugin.blockRefModDrop = { alt: null, ctrl: null, shift: null }
    thisPlugin.blockRefModDrag = { alt: null, ctrl: null, shift: null }
    const dragGhost = thisPlugin.searchResGhost;
    if (dragGhost) { dragGhost.remove(); }
    const dragZoneLine = thisPlugin.dragZoneLine;
    if (dragZoneLine) {
        dragZoneLine.remove();
        thisPlugin.dragZoneLine.style.left = '-10px';
        thisPlugin.dragZoneLine.style.top = '-10px';
    }
    thisPlugin.dragZoneLineObj = { mdEditor: null, edPos: null, cmLnElem: null }
    if (thisPlugin.blockRefHandle) { thisPlugin.blockRefHandle.className = 'hide'; }
}

function clearSearchVariables(thisApp: App, thisPlugin: MyPlugin) {
    //writeConsoleLog(`clearSearchVariables`);
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
    const dragZoneLine = thisPlugin.dragZoneLine;
    if (dragZoneLine) {
        dragZoneLine.remove();
        thisPlugin.dragZoneLine.style.left = '-10px';
        thisPlugin.dragZoneLine.style.top = '-10px';
    }
    thisPlugin.dragZoneLineObj = { mdEditor: null, edPos: null, cmLnElem: null }
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
            blockType = foundItemMatch.type; //paragraph | heading | list | code | blockquote | html
            if (blockType === 'list') { //Find the children list items
                startLn = lineNumber;
                let cacheLists: ListItemCache[] = mdCache.listItems;
                let foundParent: number = null;
                let foundEnd: boolean = false;
                cacheLists.forEach((eachListItem) => {
                    if (!foundEnd) {
                        if (eachListItem.position.start.line === lineNumber) { foundParent = eachListItem.parent }
                        if (foundParent !== null) {
                            if (foundParent < eachListItem.parent || eachListItem.position.start.line === lineNumber) {
                                endLn = eachListItem.position.start.line;
                            } else {
                                foundEnd = true;
                            }
                        }
                    }
                })
            } else {
                startLn = foundItemMatch.position.start.line;
                endLn = foundItemMatch.position.end.line;
            }
        }
    }
    return { type: blockType, start: startLn, end: endLn };
}

function cleanupElements(thisApp: App, thisPlugin: MyPlugin) {
    //Cleanup all references of my HTML elements and event listeners
    //writeConsoleLog(`cleanupElements (should only run on unload of plugin)`);
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

    oldElem = document.getElementById('drag-drop-line');
    if (oldElem) { oldElem.remove() }
    if (oldElem) { oldElem.detach() }
    if (oldElem) { oldElem = null }
    thisPlugin.dragZoneLine = null;

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
            //writeConsoleLog(`Setting up the Search Drag Handler element`);
            const searchElement: HTMLDivElement = thisPlugin.docBody.createEl('div');
            searchElement.id = 'search-res-hover';
            thisPlugin.searchResHandle = searchElement;
            searchElement.draggable = true;
            searchElement.innerText = "⋮⋮";
            searchElement.style.fontSize = thisPlugin.settings.dragFontSize;

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
            //writeConsoleLog(`Setting up the Drag Ghost element`);
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
            //writeConsoleLog(`Setting up the Block Drag Handler element`);
            const blockElement: HTMLDivElement = thisPlugin.docBody.createEl('div');
            blockElement.id = 'block-ref-hover';
            thisPlugin.blockRefHandle = blockElement;
            blockElement.draggable = true;
            blockElement.innerText = "⋮⋮";
            blockElement.style.fontSize = thisPlugin.settings.dragFontSize;

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
                if (thisPlugin.blockRefHandle) { thisPlugin.blockRefHandle.className = 'dragging'; }
                setupBlockDragStart(thisApp, thisPlugin, evt);
            })

            blockElement.addEventListener('drag', (evt: DragEvent) => {
                //The custom drag element needs to "follow" the mouse move / drag and update its position
                const dragGhost: HTMLDivElement = thisPlugin.searchResGhost;
                if (dragGhost) {
                    dragGhost.style.left = `${evt.pageX + 10}px`;
                    dragGhost.style.top = `${evt.pageY + -30}px`;
                }

                const eventDiv: HTMLPreElement = getHoveredElement(evt) as HTMLPreElement;
                //writeConsoleLog(eventDiv);
                if (eventDiv !== thisPlugin.dragZoneLineObj.cmLnElem) {
                    let gutterELem: boolean = false;
                    gutterELem = eventDiv.className === `CodeMirror-gutters` || eventDiv.className === `CodeMirror-gutter CodeMirror-foldgutter`;
                    if (gutterELem || (eventDiv.className.indexOf(`CodeMirror-line`) > -1 && eventDiv.tagName === 'PRE')) {
                        //writeConsoleLog(evt.pageY);
                        //Drag and drop - drop zone horizontal line to choose which lines to drop between
                        const dragDropLine: HTMLHRElement = thisPlugin.dragZoneLine;
                        if (dragDropLine) {
                            const hoveredEditor: Editor = getEditorByElement(thisApp, eventDiv);
                            if (hoveredEditor) {
                                const hoveredPos: EditorPosition = getHoveredCmLineEditorPos(hoveredEditor, evt);
                                hoveredEditor.setSelection(hoveredPos);
                                const lineCoords = getCoordsForCmLine(hoveredEditor, hoveredPos);
                                const useNextLine = getCoordsForCmLine(hoveredEditor, { line: hoveredPos.line + 1, ch: 0 });
                                //writeConsoleLog(lineCoords);
                                dragDropLine.style.left = `${lineCoords.left - 20}px`;
                                if (useNextLine.top !== lineCoords.top) {
                                    dragDropLine.style.top = `${useNextLine.top + 0}px`;
                                } else {
                                    dragDropLine.style.top = `${lineCoords.bottom + 0}px`;
                                }
                                thisPlugin.dragZoneLineObj = { mdEditor: hoveredEditor, edPos: hoveredPos, cmLnElem: eventDiv };
                                if (thisPlugin.blockRefSource.cmLnElem) {
                                    if (!thisPlugin.blockRefSource.cmLnElem.id) {
                                        thisPlugin.blockRefSource.cmLnElem.id = `source-cm-line`;
                                        writeConsoleLog(`Add ID... class: ${thisPlugin.blockRefSource.cmLnElem.className}`);
                                    }
                                }
                            } else {
                                writeConsoleLog(`couldn't find editor`);
                            }
                        }
                    }
                } else {
                    //writeConsoleLog(`same element`)
                }
            })

            blockElement.addEventListener('dragend', (evt: DragEvent) => {
                if (thisPlugin.blockRefDragState === 'dragstart') { clearMarkdownVariables(thisApp, thisPlugin); }
            })
        }

        let setupDragDropZoneLineElem: boolean = true;
        if (thisPlugin.dragZoneLine) { setupDragDropZoneLineElem = false; }

        if (setupDragDropZoneLineElem) {
            writeConsoleLog(`Setting up the Drag Drop Zone horizontal line element`);
            const dragDropLine = thisPlugin.docBody.createEl('hr', { text: '' });
            thisPlugin.dragZoneLine = dragDropLine;
            dragDropLine.id = 'drag-drop-line';
            dragDropLine.addClass('drag-drop-line');

            //Removing from DOM but it still sticks around in the background and then i re-append it to body when needed
            //thisPlugin.dragZoneLine.remove();
        }
    } else {
        //writeConsoleLog(`No document body variable set`);
        thisPlugin.docBody = document.querySelector("body");
    }
}

function setupEventListeners(thisApp: App, thisPlugin: MyPlugin) {
    //writeConsoleLog(`setupEventListeners`);
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
        //writeConsoleLog(`setupModRootLeft`);
        createBodyElements(thisApp, thisPlugin);
        //Find the main DIV that holds the left sidebar search pane
        const actDocSearch: HTMLDivElement = document.querySelector('.workspace-split.mod-horizontal.mod-left-split') as HTMLDivElement;
        thisPlugin.elModLeftSplit = actDocSearch;

        thisPlugin.registerDomEvent(actDocSearch, 'wheel', (evt: WheelEvent) => {
            if (thisPlugin.searchResHandle) { thisPlugin.searchResHandle.className = 'hide'; }
        })

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
                //writeConsoleLog(`Search Mouse Out`);
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
        //writeConsoleLog(`setupModRoot`);
        createBodyElements(thisApp, thisPlugin);
        //Find the main DIV that holds all the markdown panes
        const actDoc: HTMLDivElement = document.querySelector('.workspace-split.mod-vertical.mod-root') as HTMLDivElement;
        thisPlugin.elModRoot = actDoc;

        thisPlugin.registerDomEvent(actDoc, 'wheel', (evt: WheelEvent) => {
            if (thisPlugin.blockRefHandle) { thisPlugin.blockRefHandle.className = 'hide'; }
            if (thisPlugin.dragZoneLine) { thisPlugin.dragZoneLine.style.left = '0px'; thisPlugin.dragZoneLine.style.top = '-10px'; }
        })

        thisPlugin.registerDomEvent(actDoc, 'mousemove', (evt: MouseEvent) => {
            let mainDiv: HTMLElement = evt.target as HTMLElement;
            let divClass: string = mainDiv.className;
            //Don't be confused as this is the plural CodeMirror-lineS class which is the entire editor itself
            if (divClass === 'CodeMirror-lines') {
                if (thisPlugin.blockRefHandle) { thisPlugin.blockRefHandle.className = 'hide'; }
            }

            //THE GOALS OF ALL THE CHECKS AND IF STATEMENT BELOW IS TO WEED OUT AS MUCH OF THE PROCESSING AS POSSIBLE SINCE FIRING ON EVERY MOUSE MOVE
            const rolePres = mainDiv.getAttribute(`role`) === `presentation`;
            const CMline = divClass.indexOf('CodeMirror-line') > -1;
            const indentElements = divClass.indexOf('cm-hmd-list-indent') > -1 || divClass.indexOf('cm-formatting-list') > -1 || divClass.indexOf('cm-list') > -1;
            const gutterElements = divClass === '' || divClass.indexOf('CodeMirror-gutter') > -1;

            if ((rolePres && mainDiv.tagName === 'SPAN') || (CMline && mainDiv.tagName === 'PRE') || indentElements || gutterElements) {
                let gutterScrollArea: boolean = false;
                //Check if the gutter area on right side of pane in which case we do NOT want to show drag handle
                if (divClass === '' && mainDiv.parentElement.className === 'CodeMirror-vscrollbar' && evt.offsetX < (mainDiv.offsetWidth / 2)) { gutterScrollArea = true }

                if (gutterScrollArea || divClass !== '' || rolePres) {
                    //Want drag handle only to appear when near the left side / start of the line (< 150px)
                    if (evt.offsetX < 150 || (!CMline && divClass.indexOf('cm-list') === -1 && !rolePres)) {
                        //Find the leaf that is being hovered over
                        let hoveredLeaf: WorkspaceLeaf = findHoveredLeaf(thisApp);
                        let mdView: MarkdownView;
                        if (hoveredLeaf) { mdView = hoveredLeaf.view as MarkdownView; }
                        if (mdView) {
                            thisPlugin.blockRefClientY = evt.clientY;
                            let mdEditor: Editor = mdView.editor;
                            let topPos: number = thisPlugin.blockRefClientY;
                            //NOTE: mdEditor.posAtCoords(x, y) is equivalent to mdEditor.cm.coordsChar({ left: x, top: y })
                            let cmPosTmp: EditorPosition = mdEditor.posAtCoords(0, topPos);
                            let thisLine: number = cmPosTmp.line;
                            let cmPos: EditorPosition = { line: thisLine, ch: 0 };
                            if (thisPlugin.blockRefSource.leaf !== hoveredLeaf || thisPlugin.blockRefSource.lnDragged !== thisLine || thisPlugin.blockRefHandle.className === 'hide') {
                                thisPlugin.blockRefSource.leaf = hoveredLeaf;
                                thisPlugin.blockRefSource.lnDragged = thisLine;

                                //Find the PRE .CodeMirror-line element... used to find the height of the line so drag handle can be centered vertically
                                let findCmPre = getCMlnPreElem(mdEditor, cmPos);
                                let coordsForLine: lineCoordinates = findCmPre.lnCoords;
                                let findCmPreElem: HTMLPreElement = findCmPre.el;
                                if (findCmPreElem) {
                                    thisPlugin.blockRefSource.cmLnElem = findCmPreElem;
                                    let blockHandleElement: HTMLDivElement = thisPlugin.blockRefHandle;
                                    blockHandleElement.className = 'show';
                                    let elemHeight = findCmPreElem.offsetHeight;
                                    blockHandleElement.style.lineHeight = `${elemHeight}px`;
                                    let targArea = mdView.containerEl.querySelector('.CodeMirror.cm-s-obsidian.CodeMirror-wrap');
                                    let leafRect = targArea.getBoundingClientRect();
                                    blockHandleElement.style.top = `${coordsForLine.top + 0}px`;
                                    blockHandleElement.style.left = `${leafRect.left - 15 + parseInt(thisPlugin.settings.dragOffset)}px`;
                                }
                            } else {
                                //writeConsoleLog('same hovered line... no need to re-run code');
                            }
                        }
                    } else {
                        if (thisPlugin.blockRefHandle) {
                            //writeConsoleLog(`CM Line greater than 150px: ${divClass}`);
                            if (thisPlugin.blockRefHandle.className === 'show') { thisPlugin.blockRefHandle.className = 'hide' }
                        }
                    }
                }
            }
        })

        thisPlugin.registerDomEvent(actDoc, 'mouseout', (evt: MouseEvent) => {
            const elem: HTMLElement = evt.target as HTMLElement;
            const elemClass: string = elem.className;
            //writeConsoleLog(elem);
            //writeConsoleLog(elemClass);
            //if (elemClass === 'CodeMirror-lines' || elemClass === '' || elemClass === 'workspace-split mod-horizontal' || elemClass === 'workspace-leaf-resize-handle') {
            if (elemClass === 'CodeMirror-lines' || elemClass === 'workspace-split mod-horizontal' || elemClass === 'workspace-leaf-resize-handle') {
                writeConsoleLog(`Block Mouse Out: ${elemClass}`);
                if (thisPlugin.blockRefHandle) { thisPlugin.blockRefHandle.className = 'hide'; }
            }
        })

        thisPlugin.registerDomEvent(actDoc, 'drop', async (evt: DragEvent) => {
            thisPlugin.searchResDragState = 'dropped';
            if (thisPlugin.blockRefDragState === 'dragstart' && thisPlugin.dragZoneLineObj.edPos) {
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

                    //If header or block reference was dropped onto the same page then remove the file name from the reference
                    if (thisPlugin.blockRefModDrag.alt && !thisPlugin.blockRefModDrag.ctrl && !thisPlugin.blockRefModDrag.shift) {
                        let startView: MarkdownView = thisPlugin.blockRefSource.leaf.view as MarkdownView;
                        if (mdView === startView) {
                            selectedText = selectedText.replace(mdView.file.basename, '');
                        }
                    }

                    const curLine = thisPlugin.dragZoneLineObj.edPos.line;
                    //let curSelection = mdEditor.getSelection();
                    let curSelection = selectedText;
                    //Undoes the native drop of the text which Obsidian leaves as selected text to avoid multiple undo funky things when user wants to undo
                    mdEditor.undo();
                    let curLnText = mdEditor.getLine(curLine);
                    //check if list item starting with 4 spaces or Tab characters
                    const useTabs: boolean = thisApp.vault.getConfig('useTab');
                    const tabSpaces: number = thisApp.vault.getConfig('tabSize');
                    let isListItem: boolean = false;
                    let prependStr = '';
                    let listChar = '';
                    let indCtr = 0;
                    let beforeList = curLnText.match(/^([ \t]+)(.?)/);
                    if (beforeList) {
                        isListItem = true;
                        //Check if tabs
                        if (beforeList[1].match(/^\t/)) {
                            //tabs
                            indCtr = beforeList[1].split(`\t`).length - 1;
                        } else {
                            //spaces
                            indCtr = beforeList[1].split(` `).length - 1;
                        }
                        listChar = beforeList[2] + ' ';
                    } else {
                        //Need to check if the line is a list item that is at root so no spaces/tabs before it
                        let rootList = curLnText.match(/^[\*\-] /);
                        if (rootList) {
                            isListItem = true;
                            indCtr = 0;
                            listChar = rootList[0];
                        }
                    }

                    if (isListItem) {
                        //mdCache section types: paragraph | heading | list | code | blockquote | html
                        if (`heading,code,html`.contains(thisPlugin.blockRefSource.type) && !thisPlugin.blockRefModDrag.alt) {
                            prependStr = '';
                            listChar = '';
                            curSelection = `\n${curSelection}\n`
                        } else {
                            if (useTabs) {
                                prependStr = `\t`.repeat(indCtr + 1);
                            } else {
                                prependStr = ` `.repeat(indCtr + (1 * tabSpaces));
                            }
                        }
                    }

                    let multiLineList: boolean = false;
                    if (thisPlugin.blockRefSource.type === 'list') {
                        multiLineList = true;
                        if (listChar === '') {
                            listChar = curSelection.trim().substr(0, 1) + ` `;
                        }
                        const multiLines = curSelection.split(`\n`);
                        writeConsoleLog(multiLines.length);
                        let firstIndent: string = null;
                        let ctr: number = 0;
                        multiLines.forEach((eachLine) => {
                            ctr++;
                            if (firstIndent === null) {
                                let indMatch = eachLine.match(/^[ \t]+/);
                                if (indMatch) {
                                    firstIndent = indMatch[0];
                                } else {
                                    firstIndent = ``;
                                }
                            } else {
                                writeConsoleLog(`it is no longer null`);
                            }
                            let newVal = eachLine.replace(firstIndent, '');
                            let newMatch = newVal.match(/^[ \t]+/);
                            let moreInd = ``;
                            if (newMatch) {
                                moreInd = newMatch[0];
                            }
                            newVal = newVal.replace(/^[ \t]+.?/, '').trim();
                            newVal = newVal.replace(/^[\*\-] /, '').trim();
                            newVal = `${moreInd}${prependStr}${listChar}${newVal}`;
                            if (ctr === 1) {
                                curSelection = `${newVal}`
                            } else {
                                curSelection = `${curSelection}\n${newVal}`
                            }
                        })
                    }

                    if (multiLineList) {
                        mdEditor.setLine(curLine, `${curLnText}\n${curSelection}`)
                    } else {
                        mdEditor.setLine(curLine, `${curLnText}\n${prependStr}${listChar}${curSelection}`)
                    }

                    let extraLines: number = 0;
                    //Need to increment the original line variable by 1 with \n in the same file/leaf/view/pane
                    writeConsoleLog(`${thisPlugin.blockRefSource.lnStart} - ${thisPlugin.blockRefSource.lnEnd} - ${thisPlugin.blockRefSource.lnDragged}`)
                    if (thisPlugin.blockRefSource.lnDragged > droppedLine && thisPlugin.blockRefSource.leaf === mdView.leaf) {
                        extraLines++;
                        thisPlugin.blockRefSource.lnStart = thisPlugin.blockRefSource.lnStart + extraLines;
                        thisPlugin.blockRefSource.lnEnd = thisPlugin.blockRefSource.lnEnd + extraLines;
                        thisPlugin.blockRefSource.lnDragged = thisPlugin.blockRefSource.lnDragged + extraLines;
                    }
                    writeConsoleLog(`${thisPlugin.blockRefSource.lnStart} - ${thisPlugin.blockRefSource.lnEnd} - ${thisPlugin.blockRefSource.lnDragged}`)
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
                    //writeConsoleLog('search result HEADER ref');
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

function getHoveredElement(evt: DragEvent | MouseEvent): HTMLElement {
    return document.elementFromPoint(evt.pageX, evt.pageY) as HTMLElement;
}

function getEditorByElement(thisApp: App, elem: HTMLElement): Editor {
    let hoveredLeaf: WorkspaceLeaf = findHoveredLeafByElement(thisApp, elem);
    let mdView: MarkdownView;
    if (hoveredLeaf) { mdView = hoveredLeaf.view as MarkdownView; }
    if (mdView) {
        let mdEditor: Editor = mdView.editor;
        return mdEditor;
    } else {
        return null;
    }
}

function getHoveredCmLineEditorPos(mdEditor: Editor, evt: DragEvent | MouseEvent): EditorPosition {
    let topPos: number = evt.pageY;
    //NOTE: mdEditor.posAtCoords(x, y) is equivalent to mdEditor.cm.coordsChar({ left: x, top: y })
    let cmPosTmp: EditorPosition = mdEditor.posAtCoords(0, topPos);
    let thisLine: number = cmPosTmp.line;
    let cmPos: EditorPosition = { line: thisLine, ch: 0 };
    return cmPos;
}

function getCoordsForCmLine(mdEditor: Editor, cmPos: EditorPosition): lineCoordinates {
    let coordsForLine: lineCoordinates = mdEditor.coordsAtPos(cmPos);
    return coordsForLine;
}

function writeConsoleLog(logString: any) {
    if (myConsoleLogs) {
        if (logString instanceof HTMLElement) {
            console.log(logString);
        } else {
            console.log(`[${pluginName}]: ${logString.toString()}`);
        }
    }
}

function getCMlnPreElem(cmEditor: Editor, cmPos: EditorPosition): { el: HTMLPreElement, lnCoords: lineCoordinates } {
    const cmLineCoors: lineCoordinates = cmEditor.coordsAtPos(cmPos);
    let cmLineElem: HTMLElement = document.elementFromPoint(cmLineCoors.left + 1, cmLineCoors.top + 1) as HTMLElement;
    let findCmPreElem = cmLineElem;
    let foundPre: boolean = false;
    if (cmLineElem.className.indexOf('CodeMirror-line') === -1) {
        //writeConsoleLog(`First miss: ${cmLineElem.className}`);
        if (cmLineElem.parentElement.parentElement.className.indexOf('CodeMirror-line') > -1) {
            findCmPreElem = cmLineElem.parentElement.parentElement;
            foundPre = true;
        } else {
            //writeConsoleLog(`Second miss: ${cmLineElem.parentElement.parentElement.className}`);
            if (cmLineElem.parentElement.className.indexOf('CodeMirror-line') > -1) {
                findCmPreElem = cmLineElem.parentElement;
                foundPre = true;
            } else {
                //writeConsoleLog(`Third miss: ${cmLineElem.parentElement.className}`);
            }
        }
    } else {
        foundPre = true;
    }

    if (findCmPreElem.tagName === 'PRE' && foundPre) {
        return { el: findCmPreElem as HTMLPreElement, lnCoords: cmLineCoors };
    } else {
        return { el: null, lnCoords: null };
    }
}