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
	mySetting: string;
}

const DEFAULT_SETTINGS: MyPluginSettings = {
	mySetting: 'default'
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
                        //this.app.workspace.setActiveLeaf(this.blockRefStartLeaf);
                        let mdView: MarkdownView;
                        if (this.blockRefStartLeaf) { mdView = this.blockRefStartLeaf.view as MarkdownView; }
                        if (mdView) {
                            let mdEditor: Editor = mdView.editor;

                            //No modifier keys held so move the block to the new location
                            if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && !this.blockRefModDrag.shift) {
                                //Delete the original line you dragged
                                mdEditor.setLine(this.blockRefStartLine, '');
                            }

                            //Shift key held so copy the block to the new location
                            if (!this.blockRefModDrag.ctrl && !this.blockRefModDrag.alt && this.blockRefModDrag.shift) {
                                //Do not have to do anything to the original block you dragged because it is just a copy / duplicate command
                            }

                            //Alt key held to create a block reference (CMD/Ctrl is not working for MACs so going with Alt)
                            if (this.blockRefModDrag.alt && !this.blockRefModDrag.ctrl && !this.blockRefModDrag.shift) {
                                mdEditor.setLine(this.blockRefStartLine, this.blockRefNewLine);
                                mdEditor.setSelection({ line: this.blockRefStartLine, ch: 0 }, { line: this.blockRefStartLine, ch: 9999 });
                            }
                        }
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

            if (evt.ctrlKey && evt.shiftKey) {
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
        });

        this.registerDomEvent(actDoc, 'drop', (evt: DragEvent) => {
            if (this.blockRefDragState === 'start') {
                this.blockRefDragState = 'dropped';
                this.blockRefModDrop = { alt: evt.altKey, ctrl: (evt.ctrlKey || evt.metaKey), shift: evt.shiftKey }
            }
        })
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
		let {containerEl} = this;

		containerEl.empty();

        containerEl.createEl('h2', { text: 'Drag and Drop Block Settings' });

		new Setting(containerEl)
            .setName('Setting 1')
            .setDesc('This is a placeholder only and doesn\'t do anything at this point')
			.addText(text => text
                .setPlaceholder('N/A')
				.setValue('')
                .onChange(async (value) => {
					this.plugin.settings.mySetting = value;
					await this.plugin.saveSettings();
				}));
	}
}
