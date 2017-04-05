'use strict';

import {
    commands,
    workspace,
    window,
    Uri
} from 'vscode';

import * as Path from 'path';

import {PerforceService} from './PerforceService';
import {Display} from './Display';
import {Utils} from './Utils';
import {realpathSync} from 'fs';

export namespace PerforceCommands 
{
    export function registerCommands() {
        commands.registerCommand('perforce.add', addOpenFile);
        commands.registerCommand('perforce.edit', editOpenFile);
        commands.registerCommand('perforce.revert', revert);
        commands.registerCommand('perforce.diff', diff);
        commands.registerCommand('perforce.diffRevision', diffRevision);
        commands.registerCommand('perforce.info', info);
        commands.registerCommand('perforce.opened', opened);
        commands.registerCommand('perforce.showOutput', showOutput);
        commands.registerCommand('perforce.menuFunctions', menuFunctions);
    }

    function addOpenFile() {
        var editor = window.activeTextEditor;
        if(!checkFileSelected()) {
            return false;
        }

        var filePath = editor.document.uri.fsPath;
        if(checkFolderOpened()) {
            add(filePath);
        } else {
            add(filePath, Path.dirname(filePath));
        }
    }

    export function add(filePath: string, directoryOverride?: string) {
        PerforceService.execute("add", (err, stdout, stderr) => {
            PerforceService.handleCommonServiceResponse(err, stdout, stderr);
            if(!err) {
                window.setStatusBarMessage("Perforce: file opened for add", 3000);
            }
        }, realpathSync(filePath), directoryOverride ? realpathSync(directoryOverride) : directoryOverride);
    }    

    function editOpenFile() {
        var editor = window.activeTextEditor;
        if(!checkFileSelected()) {
            return false;
        }

        var filePath = editor.document.uri.fsPath; 

        //If folder not opened, run p4 in files folder.
        if(checkFolderOpened()) {
            edit(filePath);
        } else {
            edit(filePath, Path.dirname(filePath));
        }
    }

    export function edit(filePath: string, directoryOverride?: string): Promise<boolean> {
        return new Promise((resolve, reject) => {
            PerforceService.execute("edit", (err, stdout, stderr) => {
                PerforceService.handleCommonServiceResponse(err, stdout, stderr);
                if(!err) {
                    window.setStatusBarMessage("Perforce: file opened for edit", 3000);
                }
                resolve(err);
            }, realpathSync(filePath), directoryOverride ? realpathSync(directoryOverride) : directoryOverride);
        });
    }

    export function p4delete(filePath: string) {
        PerforceService.execute("delete", (err, stdout, stderr) => {
            PerforceService.handleCommonServiceResponse(err, stdout, stderr);
            if(!err) {
                window.setStatusBarMessage("Perforce: file marked for delete", 3000);
            }
        }, realpathSync(filePath));
    }

    export function revert() {
        var editor = window.activeTextEditor;
        if(!checkFileSelected()) {
            return false;
        }

        //If folder not opened, overrided p4 directory
        var filePath = editor.document.uri.fsPath;
        var directoryOverride = null;
        if(!checkFolderOpened()) {
            directoryOverride = Path.dirname(filePath);
        }

        PerforceService.execute("revert", (err, stdout, stderr) => {
            PerforceService.handleCommonServiceResponse(err, stdout, stderr);
            if(!err) {
                window.setStatusBarMessage("Perforce: file reverted", 3000);
            }
        }, realpathSync(filePath), directoryOverride ? realpathSync(directoryOverride) : directoryOverride);
    }

    export function diff(revision?: number) {
        var editor = window.activeTextEditor;
        if(!checkFileSelected()) {
            return false;
        }

        if(!checkFolderOpened()) {
            return false;
        }

        var doc = editor.document;

        if(!doc.isUntitled) {
            Utils.getFile(realpathSync(doc.uri.fsPath), revision).then((tmpFile: string) => {
                var tmpFileUri = Uri.file(tmpFile)
                var revisionLabel = isNaN(revision) ? 'Most Recent Revision' : `Revision #${revision}`;
                commands.executeCommand('vscode.diff', tmpFileUri, doc.uri, Path.basename(doc.uri.fsPath) + ' - Diff Against ' + revisionLabel);
            }, (err) => {
                Display.showError(err.toString());
            })
        }
    }

    export function diffRevision() {
        window.showInputBox({prompt: 'What revision would you like to diff?'})
            .then(val => diff(parseInt(val)));
    }

    export function info() {
        if(!checkFolderOpened()) {
            return false;
        }

        PerforceService.execute('info', PerforceService.handleCommonServiceResponse);
    }

    export function opened() {
        if(!checkFolderOpened()) {
            return false;
        }

        PerforceService.execute('opened', (err, stdout, stderr) => {
            if(err){
                Display.showError(err.message);
            } else if(stderr) {
                Display.showError(stderr.toString());
            } else {
                var opened = stdout.toString().trim().split('\n')
                if (opened.length === 0) {
                    return false;
                }
                
                var options = opened.map((file) => {
                    return {
                        description: file,
                        label: Path.basename(file)
                    }
                });

                window.showQuickPick(options, {matchOnDescription: true}).then(selection => {
                    if (!selection) {
                        return false;
                    }

                    let depotPath = selection.description;
                    var whereFile = depotPath.substring(0, depotPath.indexOf('#'));
                    where(whereFile).then((result) => {
                        // https://www.perforce.com/perforce/r14.2/manuals/cmdref/p4_where.html
                        var results = result.split(' ');
                        if (results.length >= 3) {
                            var fileToOpen = results[2].trim();
                            workspace.openTextDocument(Uri.file(fileToOpen)).then((document) => {
                                window.showTextDocument(document);
                            }, (reason) => {
                                Display.showError(reason);
                            });
                        }
                    }).catch((reason) => {
                        Display.showError(reason);
                    });
                });
            }
        });
    }

    function where(file: string): Promise<string> {
        return new Promise((resolve, reject) => {
            if(!checkFolderOpened()) {
                reject();
                return;
            }

            PerforceService.execute('where', (err, stdout, stderr) => {
                if(err){
                    Display.showError(err.message);
                    reject(err);
                } else if(stderr) {
                    Display.showError(stderr.toString());
                    reject(stderr);
                } else {
                    resolve(stdout.toString());
                }
            }, file);
        });
    }

    export function showOutput() {
        Display.channel.show();
    }

    export function menuFunctions() {
        var items = [];
        items.push({ label: "add", description: "Open a new file to add it to the depot" });
        items.push({ label: "edit", description: "Open an existing file for edit" });
        items.push({ label: "revert", description: "Discard changes from an opened file" });
        items.push({ label: "diff", description: "Display diff of client file with depot file" });
        items.push({ label: "diffRevision", description: "Display diff of client file with depot file at a specific revision" });
        items.push({ label: "info", description: "Display client/server information" });
        items.push({ label: "opened", description: "View 'open' files and open one in editor" });
        window.showQuickPick(items, {matchOnDescription: true, placeHolder: "Choose a Perforce command:"}).then(function (selection) {
            if(selection == undefined)
                return;
            switch (selection.label) {
                case "add":
                    addOpenFile();
                    break;
                case "edit":
                    editOpenFile();
                    break;
                case "revert":
                    revert();
                    break;
                case "diff":
                    diff();
                    break;
                case "diffRevision":
                    diffRevision();
                    break;
                case "info":
                    info();
                    break;
                case "opened":
                    opened();
                    break;
                default:
                    break;
            }
        });
    }

    function checkFileSelected() {
        if(!window.activeTextEditor) {
            window.setStatusBarMessage("Perforce: No file selected", 3000);
            return false;
        }

        return true;
    }

    export function checkFolderOpened() {
        if (workspace.rootPath == undefined) {
            window.setStatusBarMessage("Perforce: No folder selected", 3000);
            return false;
        }

        return true;
    }
}