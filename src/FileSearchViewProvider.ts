// src/FileSearchViewProvider.ts

import * as vscode from 'vscode';
import * as path from 'path';

export class FileSearchViewProvider implements vscode.WebviewViewProvider {

    public static readonly viewType = 'search-files.file-searcher.view'; // Must match the ID in package.json

    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri
    ) { }

    public async showAndFocus() {
        // Show the view in the sidebar
        await vscode.commands.executeCommand('search-files.file-searcher.view.focus');
        // Focus the search input
        if (this._view) {
            this._view.webview.postMessage({ type: 'focus' });
        }
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        // Focus search input when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                webviewView.webview.postMessage({ type: 'focus' });
            }
        });

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'search':
                    {
                        if (!data.value) {
                            webviewView.webview.postMessage({ type: 'results', results: [] });
                            return;
                        }
                        
                        // Fetch all files and then filter them in the extension host
                        // to ensure consistent filtering logic across all platforms.
                        const allFiles = await vscode.workspace.findFiles('**/*');
                        
                        const searchResults = allFiles.filter(file => {
                            const fileName = path.basename(file.fsPath);
                            
                            if (data.useRegex) {
                                try {
                                    const regex = new RegExp(data.value, data.caseSensitive ? '' : 'i');
                                    return regex.test(fileName);
                                } catch (e) {
                                    // Invalid regex, don't filter anything
                                    return false;
                                }
                            } else {
                                if (data.caseSensitive) {
                                    return fileName.includes(data.value);
                                } else {
                                    return fileName.toLowerCase().includes(data.value.toLowerCase());
                                }
                            }
                        }).map(file => {
                            const fileName = path.basename(file.fsPath);
                            return {
                                uri: file.toString(),
                                label: fileName,
                                description: vscode.workspace.asRelativePath(file),
                                boldedLabel: this._boldMatchingText(fileName, data.value, data.caseSensitive)
                            };
                        }).sort((a, b) => {
                            return this._compareFilesByRelevance(a.label, b.label, data.value, data.caseSensitive);
                        });
                        
                        webviewView.webview.postMessage({ type: 'results', results: searchResults });
                        break;
                    }
                case 'openFile':
                    {
                        const uri = vscode.Uri.parse(data.uri);
                        vscode.workspace.openTextDocument(uri).then(doc => {
                            vscode.window.showTextDocument(doc);
                        });
                        break;
                    }
            }
        });
    }

    /**
     * Calculate Levenshtein edit distance between two strings
     */
    private _editDistance(s1: string, s2: string): number {
        const m = s1.length;
        const n = s2.length;
        const dp: number[][] = Array(m + 1).fill(0).map(() => Array(n + 1).fill(0));

        for (let i = 0; i <= m; i++) {
            dp[i][0] = i;
        }
        for (let j = 0; j <= n; j++) {
            dp[0][j] = j;
        }

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (s1[i - 1] === s2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1];
                } else {
                    dp[i][j] = Math.min(
                        dp[i - 1][j] + 1,     // deletion
                        dp[i][j - 1] + 1,     // insertion
                        dp[i - 1][j - 1] + 1  // substitution
                    );
                }
            }
        }

        return dp[m][n];
    }

    /**
     * Get the basename without extension
     */
    private _getBasename(filename: string): string {
        const lastDot = filename.lastIndexOf('.');
        if (lastDot > 0) {
            return filename.substring(0, lastDot);
        }
        return filename;
    }

    /**
     * Calculate match rank for a file (lower is better/higher priority)
     */
    private _calculateRank(filename: string, query: string, caseSensitive: boolean): {
        tier: number;
        editDist: number;
        length: number;
        position: number;
    } {
        const fn = caseSensitive ? filename : filename.toLowerCase();
        const q = caseSensitive ? query : query.toLowerCase();
        const basename = this._getBasename(fn);
        const queryBasename = this._getBasename(q);

        let tier = 5; // Default: fuzzy match
        let position = fn.indexOf(q);

        // Tier 0: Exact full filename match
        if (fn === q) {
            tier = 0;
            position = 0;
        }
        // Tier 1: Exact basename match (ignore extension)
        else if (basename === queryBasename || basename === q) {
            tier = 1;
            position = 0;
        }
        // Tier 2: Prefix match on basename
        else if (basename.startsWith(q)) {
            tier = 2;
            position = 0;
        }
        // Tier 3: Substring match in basename
        else if (basename.includes(q)) {
            tier = 3;
            position = basename.indexOf(q);
        }
        // Tier 4: Substring match in full filename
        else if (fn.includes(q)) {
            tier = 4;
            position = fn.indexOf(q);
        }

        // Calculate edit distance for fuzzy matching
        const editDist = this._editDistance(basename, q);

        return {
            tier,
            editDist,
            length: filename.length,
            position: position >= 0 ? position : Infinity
        };
    }

    /**
     * Compare two files by relevance to query
     */
    private _compareFilesByRelevance(
        filenameA: string,
        filenameB: string,
        query: string,
        caseSensitive: boolean
    ): number {
        const rankA = this._calculateRank(filenameA, query, caseSensitive);
        const rankB = this._calculateRank(filenameB, query, caseSensitive);

        // Primary: tier (lower tier = more relevant)
        if (rankA.tier !== rankB.tier) {
            return rankA.tier - rankB.tier;
        }

        // Tie-breaker 1: edit distance (lower is better)
        if (rankA.editDist !== rankB.editDist) {
            return rankA.editDist - rankB.editDist;
        }

        // Tie-breaker 2: shorter filename
        if (rankA.length !== rankB.length) {
            return rankA.length - rankB.length;
        }

        // Tie-breaker 3: earlier match position
        if (rankA.position !== rankB.position) {
            return rankA.position - rankB.position;
        }

        // Tie-breaker 4: alphabetical
        return filenameA.localeCompare(filenameB);
    }

    /**
     * Bold matching text in filename using Markdown
     */
    private _boldMatchingText(filename: string, query: string, caseSensitive: boolean): string {
        if (!query) {
            return filename;
        }

        const fn = caseSensitive ? filename : filename.toLowerCase();
        const q = caseSensitive ? query : query.toLowerCase();
        
        // Find all occurrences of the query in the filename
        const positions: Array<{ start: number; end: number }> = [];
        let searchPos = 0;
        
        while (searchPos < fn.length) {
            const index = fn.indexOf(q, searchPos);
            if (index === -1) {
                break;
            }
            positions.push({ start: index, end: index + query.length });
            searchPos = index + 1; // Allow overlapping matches
        }

        if (positions.length === 0) {
            return filename;
        }

        // Merge overlapping positions
        const merged: Array<{ start: number; end: number }> = [];
        for (const pos of positions) {
            if (merged.length === 0 || pos.start > merged[merged.length - 1].end) {
                merged.push(pos);
            } else {
                merged[merged.length - 1].end = Math.max(merged[merged.length - 1].end, pos.end);
            }
        }

        // Build result string with bold markers
        let result = '';
        let lastEnd = 0;
        for (const pos of merged) {
            result += filename.substring(lastEnd, pos.start);
            result += '**' + filename.substring(pos.start, pos.end) + '**';
            lastEnd = pos.end;
        }
        result += filename.substring(lastEnd);

        return result;
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'main.js'));
        const styleVSCodeUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'vscode.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleVSCodeUri}" rel="stylesheet">
                <title>File Name Search</title>
            </head>
            <body>
                <div id="search-container">
                    <input type="text" id="search-input" placeholder="Enter file name to search...">
                    <div class="search-controls">
                        <div class="control-button" id="case-sensitive-toggle" title="Match Case">Aa</div>
                        <div class="control-button" id="regex-toggle" title="Use Regular Expression">.*</div>
                    </div>
                </div>

                <div id="filter-container">
                    <label for="filter-input" class="filter-label">Files to include</label>
                    <input type="text" id="filter-input" placeholder="e.g., .ts,.js,.json">
                </div>

                <div id="results-container"></div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}