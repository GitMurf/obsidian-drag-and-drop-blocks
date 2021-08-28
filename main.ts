import { settings } from 'cluster';
import { App, Modal, Notice, Plugin, PluginSettingTab, Setting, TFile, WorkspaceLeaf, MarkdownView, Editor } from 'obsidian';
declare module "obsidian" {
    interface WorkspaceLeaf {
        containerEl: HTMLElement;
    }
    interface Editor {
        posAtCoords(left: number, top: number): EditorPosition;
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

		await this.loadSettings();

        this.addSettingTab(new SampleSettingTab(this.app, this));

        this.app.workspace.onLayoutReady(this.onLayoutReady.bind(this));
        //Primarily for switching between panes or opening a new file
        this.registerEvent(this.app.workspace.on('file-open', this.onFileChange.bind(this)));
        //Primarily for when switching between Edit and Preview mode
        this.registerEvent(this.app.workspace.on('layout-change', this.onLayoutChange.bind(this)));
    }

    onLayoutReady(): void {
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

                        //Alt key held to create a block reference (CMD/Ctrl is not working for MACs so going with Alt)
                        if (this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && !this.blockRefModDrag.shift) {
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

                            block = `![` + `[${mdView.file.basename}#^${blockid}]]`.split("\n").join("");
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

        this.registerDomEvent(actDoc, 'drop', (evt: DragEvent) => {
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
                    if (this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && !this.blockRefModDrag.shift) {
                        mdEditor2.setLine(this.blockRefStartLine, this.blockRefNewLine);
                        mdEditor2.setSelection({ line: this.blockRefStartLine, ch: 0 }, { line: this.blockRefStartLine, ch: 9999 });
                    }
                }
            }
        })
    }

    onLayoutChange(): void {
        let oldElem = document.getElementById('block-ref-hover');
        if (oldElem) { oldElem.remove() }
    }

    onFileChange(): void {
        let oldElem = document.getElementById('block-ref-hover');
        if (oldElem) { oldElem.remove() }
    }

    onunload() {
        let oldElem = document.getElementById('block-ref-hover');
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
