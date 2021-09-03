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

    //Markdown edit view variables
    docBody: HTMLBodyElement;
    blockRefHandle: HTMLElement;
    blockRefStartLine: number;
    blockRefEmbed: string;
    blockRefNewLine: string;
    originalText: string;
    blockRefDragState: string;
    blockRefDragType: string;
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
    //Variables for Search results dragging
    searchResDiv: HTMLElement;
    searchResHandle: HTMLElement;
    searchResLink: string;
    searchResContent: string;
    searchResNewBlockRef: string;
    searchResDragType: string;
    searchResDragState: string;
    searchResLocation: { start: charPos, end: charPos }
    searchResFile: TFile;
    searchResGhost: HTMLElement;

	async onload() {
        console.log("loading plugin: " + pluginName);

        //For regular markdown edit view
        clearMarkdownVariables(this.app, this);
        //For search
        clearSearchVariables(this.app, this);

        await this.loadSettings();
        this.addSettingTab(new SampleSettingTab(this.app, this));
        this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));
        //Primarily for switching between panes or opening a new file
        this.registerEvent(this.app.workspace.on('file-open', this.onFileChange.bind(this)));
        //Primarily for when switching between Edit and Preview mode
        this.registerEvent(this.app.workspace.on('layout-change', this.onLayoutChange.bind(this)));
    }

    onLayoutReady(): void {
        this.docBody = document.getElementsByTagName('body')[0];
        //Find the main DIV that holds the left sidebar search pane
        const actDocSearch: HTMLElement = document.getElementsByClassName('workspace-split mod-horizontal mod-left-split')[0] as HTMLElement;

        this.registerDomEvent(actDocSearch, 'mouseover', (evt: MouseEvent) => {
            const mainDiv: HTMLElement = evt.target as HTMLElement;
            if (mainDiv.className === 'search-result-file-match') {
                this.searchResDiv = mainDiv;
                let oldElem: HTMLElement = this.searchResHandle;
                if (oldElem) { oldElem.remove() }

                const newElement: HTMLDivElement = this.docBody.createEl('div');
                newElement.id = 'search-res-hover';
                newElement.className = 'show';
                this.searchResHandle = newElement;
                newElement.draggable = true;
                newElement.innerText = "⋮⋮";
                let targetRect = mainDiv.getBoundingClientRect();
                newElement.style.top = `${targetRect.top + 5}px`;
                newElement.style.left = `${targetRect.left - 12}px`;

                this.registerDomEvent(newElement, 'mouseover', (evt: MouseEvent) => {
                    const eventDiv: HTMLElement = evt.target as HTMLElement;
                    eventDiv.className = 'show';
                })

                this.registerDomEvent(newElement, 'mouseout', (evt: MouseEvent) => {
                    const eventDiv: HTMLElement = evt.target as HTMLElement;
                    eventDiv.className = 'hide';
                })

                this.registerDomEvent(mainDiv, 'mouseleave', (evt: MouseEvent) => {
                    if (this.searchResHandle) { this.searchResHandle.className = 'hide'; }
                })

                this.registerDomEvent(newElement, 'dragstart', (evt: DragEvent) => {
                    this.searchResDragState = 'dragstart';
                    setupSearchDragStart(this.app, this, mainDiv);

                    //Hide the :: drag handle as going to use a custom element as the "ghost image"
                    const newElement: HTMLElement = this.searchResHandle;
                    newElement.className = 'hide';
                    evt.dataTransfer.setDragImage(newElement, 0, 0);

                    if (evt.altKey) {
                        this.searchResDragType = 'ref';
                        evt.dataTransfer.setData("text/plain", this.searchResLink);
                    }
                    if (evt.shiftKey || (!evt.shiftKey && !evt.altKey && !evt.ctrlKey && !evt.metaKey)) {
                        this.searchResDragType = 'copy';
                        evt.dataTransfer.setData("text/plain", this.searchResContent);
                    }
                })

                this.registerDomEvent(newElement, 'drag', (evt: DragEvent) => {
                    //The custom drag element needs to "follow" the mouse move / drag and update its position
                    const dragGhost: HTMLElement = this.searchResGhost;
                    if (dragGhost) {
                        dragGhost.style.left = `${evt.pageX + 10}px`;
                        dragGhost.style.top = `${evt.pageY + -30}px`;
                    }
                })

                this.registerDomEvent(newElement, 'dragend', (evt: DragEvent) => {
                    if (this.searchResDragState === 'dragstart') { clearSearchVariables(this.app, this); }
                })
            }
        })

        this.registerDomEvent(actDocSearch, 'mouseleave', (evt: MouseEvent) => {
            const oldElem: HTMLElement = this.searchResHandle;
            if (oldElem) { oldElem.className = 'hide'; }
        })

        //Find the main DIV that holds all the markdown panes
        const actDoc: HTMLElement = document.getElementsByClassName('workspace-split mod-vertical mod-root')[0] as HTMLElement;

        this.registerDomEvent(actDoc, 'mouseover', (evt: MouseEvent) => {
            const mainDiv: HTMLElement = evt.target as HTMLElement;
            if (mainDiv.className === 'CodeMirror-linenumber CodeMirror-gutter-elt') {
                let oldElem: HTMLElement = this.blockRefHandle;
                if (oldElem) { oldElem.remove() }
                const newElement: HTMLDivElement = this.docBody.createEl('div');
                newElement.id = 'block-ref-hover';
                this.blockRefHandle = newElement;
                newElement.draggable = true;
                newElement.innerText = "⋮⋮";
                let targetRect = mainDiv.getBoundingClientRect();
                newElement.style.top = `${targetRect.top - 1}px`;
                newElement.style.left = `${targetRect.left - 8}px`;

                this.registerDomEvent(newElement, 'mouseover', (evt: MouseEvent) => {
                    const eventDiv: HTMLElement = evt.target as HTMLElement;
                    eventDiv.className = 'show';
                })

                this.registerDomEvent(newElement, 'mouseout', (evt: MouseEvent) => {
                    const eventDiv: HTMLElement = evt.target as HTMLElement;
                    eventDiv.className = 'hide';
                })

                this.registerDomEvent(mainDiv, 'mouseout', (evt: MouseEvent) => {
                    if (this.blockRefHandle) { this.blockRefHandle.className = 'hide'; }
                })

                //Find the leaf that is being hovered over
                let hoveredLeaf: WorkspaceLeaf = findHoveredLeaf(this.app);
                if (hoveredLeaf) {
                    this.blockRefStartLeaf = hoveredLeaf;
                    this.blockRefClientY = evt.clientY;
                }

                this.registerDomEvent(newElement, 'dragstart', (evt: DragEvent) => {
                    this.blockRefDragState = 'dragstart';
                    let hoveredLeaf: WorkspaceLeaf = this.blockRefStartLeaf;
                    let mdView: MarkdownView;
                    if (hoveredLeaf) { mdView = hoveredLeaf.view as MarkdownView; }
                    if (mdView) {
                        this.blockRefModDrag = { alt: evt.altKey, ctrl: (evt.ctrlKey || evt.metaKey), shift: evt.shiftKey }
                        let mdEditor: Editor = mdView.editor;
                        let topPos: number = this.blockRefClientY;
                        //NOTE: mdEditor.posAtCoords(x, y) is equivalent to mdEditor.cm.coordsChar({ left: x, top: y })
                        let thisLine: number = mdEditor.posAtCoords(0, topPos).line;
                        //selectEntireLine(mdEditor, thisLine, thisLine)
                        let lineContent: string = mdEditor.getLine(thisLine);

                        let blockid: string = '';
                        let finalString: string = '';
                        let block: string = '';

                        //Check to see if it is a Header line
                        if (lineContent.startsWith('#') && !this.blockRefModDrag.alt) {
                            let mdCache: CachedMetadata = this.app.metadataCache.getFileCache(mdView.file);
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
                            lineContent = mdEditor.getSelection();
                            evt.dataTransfer.setData("text/plain", lineContent);

                            //Copy
                            if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && this.blockRefModDrag.shift) {
                                this.blockRefDragType = "copy-header";
                            }
                            //Move
                            if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && !this.blockRefModDrag.shift) {
                                this.blockRefDragType = "move-header";
                            }
                        }

                        //No modifier keys held so move the block to the new location
                        if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && !this.blockRefModDrag.shift) {
                            //Check to see if it is a Header line
                            if (lineContent.startsWith('#')) {

                            } else {
                                evt.dataTransfer.setData("text/plain", lineContent);
                            }
                        }

                        //Shift key held so copy the block to the new location
                        if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && this.blockRefModDrag.shift) {
                            //Check to see if it is a Header line
                            if (lineContent.startsWith('#')) {

                            } else {
                                evt.dataTransfer.setData("text/plain", lineContent);
                            }
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
                                let blockType: string = findBlockTypeByLine(this.app, mdView.file, thisLine);
                                //console.log(blockType);

                                //If a list, skip the logic for checking if a multi line markdown block
                                if (blockType === 'list') {
                                    //console.log('this is a list item');
                                } else if (blockType === 'code') {
                                    //console.log('this is a code block');
                                } else if (thisLine !== mdEditor.lastLine() && blockType === 'paragraph') { //Regular markdown line/section, check if it is a multi line block
                                    let loopContinue = true;
                                    let ctr = thisLine;
                                    while (loopContinue) {
                                        ctr++
                                        if (ctr >= 999) { console.log('infinite loop caught'); break; }
                                        if (mdEditor.getLine(ctr) === '' || mdEditor.lastLine() <= ctr) { loopContinue = false; }
                                    }
                                    if (mdEditor.lastLine() === ctr && mdEditor.getLine(ctr) !== '') { thisLine = ctr } else { thisLine = ctr - 1 }
                                    lineContent = mdEditor.getLine(thisLine);
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
                    }
                })

                this.registerDomEvent(newElement, 'dragend', (evt: DragEvent) => {
                    if (this.blockRefDragState === 'dragstart') { clearMarkdownVariables(this.app, this); }
                })
            }

            if (this.settings.autoSelect) {
                if ((evt.ctrlKey || evt.metaKey) && evt.shiftKey) {
                    //Find the leaf that is being hovered over
                    let hoveredLeaf: WorkspaceLeaf = findHoveredLeaf(this.app);
                    let mdView: MarkdownView;
                    if (hoveredLeaf) { mdView = hoveredLeaf.view as MarkdownView; }
                    if (mdView) {
                        let mdEditor: Editor = mdView.editor;
                        let topPos: number = evt.clientY + 1;
                        //NOTE: mdEditor.posAtCoords(x, y) is equivalent to mdEditor.cm.coordsChar({ left: x, top: y })
                        let thisLine: number = mdEditor.posAtCoords(0, topPos).line;
                        selectEntireLine(mdEditor, thisLine, thisLine)
                    }
                }
            }
        });

        this.registerDomEvent(actDoc, 'drop', async (evt: DragEvent) => {
            this.searchResDragState = 'dropped';
            if (this.blockRefDragState === 'dragstart') {
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
                            selectEntireLine(mdEditor, thisLine + 1, thisLine + 1)
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
                        selectEntireLine(mdEditor, thisLine + 1, thisLine + 1)

                        //Need to increment the original line variable by 1 or 2 because you added an extra line (or two) with \n in the same file/leaf/view/pane
                        if (this.blockRefStartLine > thisLine && this.blockRefStartLeaf === mdView.leaf) { this.blockRefStartLine = this.blockRefStartLine + extraLines; }
                    }
                }

                //For the original source leaf that you dragged stuff FROM
                let mdView2: MarkdownView;
                if (this.blockRefStartLeaf) { mdView2 = this.blockRefStartLeaf.view as MarkdownView; }
                if (mdView2) {
                    let mdEditor2: Editor = mdView2.editor;

                    //No modifier keys held so move the block to the new location
                    if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && !this.blockRefModDrag.shift) {
                        if (this.blockRefDragType === "move-header") {
                            mdEditor2.replaceSelection('');
                        } else {
                            //Delete the original line you dragged by setting it and the next line to the next line text
                            let startLine: number = this.blockRefStartLine;
                            let endLine: number = this.blockRefStartLine + 1;
                            let stringToReplace: string = mdEditor2.getLine(endLine);

                            if (endLine > mdEditor2.lastLine()) {
                                endLine = mdEditor2.lastLine();
                                if (startLine > 0) {
                                    startLine = startLine - 1;
                                    stringToReplace = mdEditor2.getLine(startLine);
                                } else {
                                    //rare circumstance that the moved line is the only one in the file
                                    //so just set to blank and don't try to delete the line above or below
                                    startLine = this.blockRefStartLine;
                                    endLine = startLine;
                                    stringToReplace = "";
                                }
                            }

                            const endOfLine = mdEditor2.getLine(endLine).length;
                            mdEditor2.replaceRange(stringToReplace, { line: startLine, ch: 0 }, { line: endLine, ch: endOfLine })
                        }
                    }

                    //Shift key held so copy the block to the new location
                    if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && this.blockRefModDrag.shift) {
                        //Do not have to do anything to the original block you dragged because it is just a copy / duplicate command
                    }

                    //Alt key held to create a block reference (CMD/Ctrl is not working for MACs so going with Alt)
                    if ((this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && !this.blockRefModDrag.shift)
                        || (this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && this.blockRefModDrag.shift)) {
                        if (this.blockRefNewLine !== this.originalText) { mdEditor2.setLine(this.blockRefStartLine, this.blockRefNewLine); }
                        selectEntireLine(mdEditor2, this.blockRefStartLine, this.blockRefStartLine)
                    }
                }
            }

            //This is for dragged items from Search results that are to be block refs and is NOT a header
            if (this.searchResDragType === 'ref') {
                //Check if a header ref in which case do NOT have to create a block reference in the source file
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

            clearMarkdownVariables(this.app, this);
            clearSearchVariables(this.app, this);
        })

        this.registerDomEvent(actDoc, 'mouseleave', (evt: MouseEvent) => {
            if (this.blockRefHandle) { this.blockRefHandle.className = 'hide'; }
        })
    }

    onLayoutChange(): void {
        //For regular markdown edit view
        clearMarkdownVariables(this.app, this);
        //For search
        clearSearchVariables(this.app, this);
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

function setupSearchDragStart(thisApp: App, thisPlugin: MyPlugin, mainDiv: HTMLElement) {
    //Create a custom "ghost" image element to follow the mouse drag like the native obsidian search result drag link dow
    let oldElem: HTMLElement = thisPlugin.searchResGhost;
    if (oldElem) { oldElem.remove() }

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
    let oldElem: HTMLElement = document.getElementById('block-ref-hover');
    if (oldElem) { oldElem.remove() }

    thisPlugin.blockRefHandle = null;
    thisPlugin.blockRefStartLine = null;
    thisPlugin.blockRefEmbed = null;
    thisPlugin.blockRefNewLine = null;
    thisPlugin.originalText = null;
    thisPlugin.blockRefDragState = null;
    thisPlugin.blockRefDragType = null;
    thisPlugin.blockRefStartLeaf = null;
    thisPlugin.blockRefClientY = null;
    thisPlugin.blockRefModDrop = { alt: null, ctrl: null, shift: null }
    thisPlugin.blockRefModDrag = { alt: null, ctrl: null, shift: null }
}

function clearSearchVariables(thisApp: App, thisPlugin: MyPlugin) {
    let oldElem: HTMLElement = document.getElementById('search-res-ghost');
    if (oldElem) { oldElem.remove() }
    oldElem = document.getElementById('search-res-hover');
    if (oldElem) { oldElem.remove() }

    thisPlugin.searchResDiv = null;
    thisPlugin.searchResHandle = null;
    thisPlugin.searchResLink = null;
    thisPlugin.searchResContent = null;
    thisPlugin.searchResNewBlockRef = null;
    thisPlugin.searchResDragType = null;
    thisPlugin.searchResDragState = null;
    thisPlugin.searchResLocation = { start: null, end: null }
    thisPlugin.searchResFile = null;
    thisPlugin.searchResGhost = null;
}

function findBlockTypeByLine(thisApp: App, file: TFile, lineNumber: number) {
    let mdCache: CachedMetadata = thisApp.metadataCache.getFileCache(file);
    let cacheSections: SectionCache[] = mdCache.sections;
    let blockType: string;
    if (cacheSections) {
        let foundItemMatch = cacheSections.find(eachSection => { if (eachSection.position.start.line <= lineNumber && eachSection.position.end.line >= lineNumber) { return true } else { return false } })
        if (foundItemMatch) { blockType = foundItemMatch.type; }
    }
    return blockType;
}