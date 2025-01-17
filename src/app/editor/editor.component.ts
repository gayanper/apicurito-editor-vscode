/**
 * @license
 * Copyright 2018 Red Hat
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Component, EventEmitter, Input, Output, ViewChild} from "@angular/core";
import { ApiDefinition, ApiEditorComponent } from "@apicurio/studio";
import {DownloaderService} from "../services/downloader.service";
import {ConfigService, GeneratorConfig} from "../services/config.service";
import * as YAML from 'js-yaml';
import {StorageService} from "../services/storage.service";
import {IOasValidationSeverityRegistry, OasValidationProblemSeverity} from "oai-ts-core";
import {VscodeExtensionService, VscodeMessage} from "../services/vscode-extension.service";
import {ApiFileEncoding} from "./api-file-encoding.type";


export class DisableValidationRegistry implements IOasValidationSeverityRegistry {

    public lookupSeverity(ruleCode: string): OasValidationProblemSeverity {
        return OasValidationProblemSeverity.ignore;
    }

}


@Component({
    moduleId: module.id,
    selector: "editor",
    templateUrl: "editor.component.html",
    styleUrls: [ "editor.component.css" ]
})
export class EditorComponent {

    private _api: ApiDefinition;
    private _originalContent: any;
    @Input()
    set api(apiDef: ApiDefinition) {
        this._api = apiDef;
        this._originalContent = apiDef.spec;
    }
    get api(): ApiDefinition {
        return this._api;
    }
    @Input()
    encoding: ApiFileEncoding;

    @Output() onClose: EventEmitter<void> = new EventEmitter<void>();

    @ViewChild("apiEditor") apiEditor: ApiEditorComponent;
    generating: boolean = false;
    generateError: string = null;

    showSuccessToast: boolean = false;
    showErrorToast: boolean = false;
    toastTimeoutId: number = null;

    persistenceTimeout: number;

    validation: IOasValidationSeverityRegistry = null;

    vscodeExtension: VscodeExtensionService;

    /**
     * Constructor.
     * @param downloader
     * @param config
     * @param storage
     */
    constructor(private downloader: DownloaderService, public config: ConfigService,
                private storage: StorageService, vscodeExtension: VscodeExtensionService) {
        this.vscodeExtension = vscodeExtension;
        vscodeExtension.bindEditorSave(() => {
            this.saveExt();
        });
    }

    /**
     * Called whenever the API definition is changed by the user.
     */
    public documentChanged(): any {
        console.info("[EditorComponent] Detected a document change, scheduling disaster recovery persistence");
        if (this.persistenceTimeout) {
            clearTimeout(this.persistenceTimeout);
            this.persistenceTimeout = null;
        }
        this.persistenceTimeout = setTimeout( () => {
            this.storage.store(this.apiEditor.getValue());
            this.persistenceTimeout = null;
        }, 5000);
    }

    public saveExt() {
        let spec: any = this.apiEditor.getValue().spec;
        if (typeof spec === "object") {
            if (this.encoding == ApiFileEncoding.JSON) {
                spec = JSON.stringify(spec, null, 4);
            } else if (this.encoding == ApiFileEncoding.YAML) {
                spec = YAML.safeDump(spec, {
                    indent: 4,
                    lineWidth: 110,
                    noRefs: true
                });
            }
            this.vscodeExtension.sendMessage(new VscodeMessage("save-req", spec));
        }
    }

    public save(format: string = "json"): Promise<boolean> {
        console.info("[EditorComponent] Saving the API definition.");
        this.generateError = null;
        let ct: string = "application/json";
        let filename: string = "openapi-spec";
        let spec: any = this.apiEditor.getValue().spec;
        if (typeof spec === "object") {
            if (format === "json") {
                spec = JSON.stringify(spec, null, 4);
                filename += ".json";
            } else {
                //spec = YAML.stringify(spec, 100, 4);
                spec = YAML.safeDump(spec, {
                    indent: 4,
                    lineWidth: 110,
                    noRefs: true
                });
                filename += ".yaml";
            }
        }
        let content: string = spec;
        return this.downloader.downloadToFS(content, ct, filename).then( rval => {
            this.storage.clear();
            return rval;
        });
    }

    public close(): void {
        console.info("[EditorComponent] Closing the editor.");
        this.generateError = null;
        this.storage.clear();
        this.onClose.emit();
    }

    public saveAndClose(): void {
        console.info("[EditorComponent] Saving and then closing the editor.");
        this.save().then( () => {
            this.close();
        });
    }

    public generate(gconfig: GeneratorConfig): void {
        console.info("[EditorComponent] Generating project: ", gconfig);

        this.generateError = null;
        this.showErrorToast = false;
        this.showSuccessToast = false;

        let spec: any = this.apiEditor.getValue().spec;
        if (typeof spec === "object") {
            spec = JSON.stringify(spec, null, 4);
        }
        let content: string = spec;
        let filename: string = "camel-project.zip";
        this.generating = true;
        this.downloader.generateAndDownload(gconfig, content, filename).then( () => {
            this.generating = false;
            this.showSuccessToast = true;
            this.toastTimeoutId = setTimeout(() => {
                this.showSuccessToast = false;
            }, 5000);
        }).catch( error => {
            console.error("[EditorComponent] Error generating project: ", error);
            this.generating = false;
            this.generateError = error.message;
            this.showErrorToast = true;
            // Only fade-away automatically for successful generation.  Error stays until dismissed.
            // this.toastTimeoutId = setTimeout(() => {
            //     this.showErrorToast = false;
            // }, 5000);
        });
    }

    public closeSuccessToast(): void {
        this.showSuccessToast = false;
        clearTimeout(this.toastTimeoutId);
    }

    public closeErrorToast(): void {
        this.showErrorToast = false;
        clearTimeout(this.toastTimeoutId);
    }

    public setValidation(enabled: boolean): void {
        if (enabled) {
            this.validation = null;
        } else {
            this.validation = new DisableValidationRegistry();
        }
    }

}
