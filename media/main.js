// media/main.js

(function () {
    const vscode = acquireVsCodeApi();

    const searchInput = document.getElementById('search-input');
    const resultsContainer = document.getElementById('results-container');
    const caseToggle = document.getElementById('case-sensitive-toggle');
    const regexToggle = document.getElementById('regex-toggle');
    const filterInput = document.getElementById('filter-input');

    let searchTimeout;
    let isCaseSensitive = false;
    let useRegex = false;
    let results = [];
    let allResults = []; // Store unfiltered results
    let selectedIndex = -1;

    // Restore previous state if available
    const previousState = vscode.getState();
    if (previousState) {
        searchInput.value = previousState.searchQuery || '';
        filterInput.value = previousState.filterQuery || '';
        isCaseSensitive = previousState.isCaseSensitive || false;
        useRegex = previousState.useRegex || false;
        allResults = previousState.allResults || [];
        selectedIndex = previousState.selectedIndex || -1;
        
        caseToggle.classList.toggle('active', isCaseSensitive);
        regexToggle.classList.toggle('active', useRegex);
        
        // Restore results display with filter applied
        if (allResults.length > 0) {
            applyFilter();
        }
    }

    // Auto-focus on load
    searchInput.focus();

    function saveState() {
        vscode.setState({
            searchQuery: searchInput.value,
            filterQuery: filterInput.value,
            isCaseSensitive: isCaseSensitive,
            useRegex: useRegex,
            allResults: allResults,
            selectedIndex: selectedIndex
        });
    }

    function applyFilter() {
        const filterValue = filterInput.value.trim();
        
        if (!filterValue) {
            // No filter, show all results
            results = allResults;
            displayResults(results);
            return;
        }

        // Parse comma-separated suffixes
        const suffixes = filterValue.split(',').map(s => s.trim().toLowerCase()).filter(s => s);
        
        if (suffixes.length === 0) {
            results = allResults;
            displayResults(results);
            return;
        }

        // Filter results by file suffix
        results = allResults.filter(file => {
            const fileName = file.label.toLowerCase();
            return suffixes.some(suffix => {
                // Add dot if not present
                const normalizedSuffix = suffix.startsWith('.') ? suffix : '.' + suffix;
                return fileName.endsWith(normalizedSuffix);
            });
        });
        
        displayResults(results);
    }

    function triggerSearch() {
        // Debounce search to avoid excessive API calls
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = searchInput.value;
            vscode.postMessage({
                type: 'search',
                value: query,
                caseSensitive: isCaseSensitive,
                useRegex: useRegex
            });
            saveState();
        }, 10); // Reduced delay for more responsive feel
    }

    searchInput.addEventListener('input', triggerSearch);

    filterInput.addEventListener('input', () => {
        applyFilter();
    });

    // Keyboard navigation for results
    searchInput.addEventListener('keydown', (e) => {
        if (results.length === 0) return;

        if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (selectedIndex < results.length - 1) {
                selectedIndex = selectedIndex + 1;
                updateSelectedResult();
            }
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (selectedIndex > 0) {
                selectedIndex = selectedIndex - 1;
                updateSelectedResult();
            }
        } else if (e.key === 'Enter' && selectedIndex >= 0) {
            e.preventDefault();
            openFile(results[selectedIndex].uri);
        }
    });

    caseToggle.addEventListener('click', () => {
        isCaseSensitive = !isCaseSensitive;
        caseToggle.classList.toggle('active', isCaseSensitive);
        triggerSearch(); // Re-run search with new setting
    });
    
    regexToggle.addEventListener('click', () => {
        useRegex = !useRegex;
        regexToggle.classList.toggle('active', useRegex);
        triggerSearch(); // Re-run search with new setting
    });

    function openFile(uri) {
        vscode.postMessage({
            type: 'openFile',
            uri: uri
        });
    }

    function updateSelectedResult() {
        const items = resultsContainer.querySelectorAll('.result-item');
        items.forEach((item, index) => {
            if (index === selectedIndex) {
                item.classList.add('selected');
                item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            } else {
                item.classList.remove('selected');
            }
        });
        saveState();
    }

    function highlightMatch(text, searchQuery) {
        if (!searchQuery) {
            return text;
        }

        try {
            let regex;
            if (useRegex) {
                regex = new RegExp(`(${searchQuery})`, isCaseSensitive ? 'g' : 'gi');
            } else {
                // Escape special regex characters for literal search
                const escapedQuery = searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                regex = new RegExp(`(${escapedQuery})`, isCaseSensitive ? 'g' : 'gi');
            }
            
            return text.replace(regex, '<strong>$1</strong>');
        } catch (e) {
            // If regex fails, return original text
            return text;
        }
    }

    function displayResults(resultsList) {
        resultsContainer.innerHTML = ''; // Clear previous results
        if (!resultsList || resultsList.length === 0) {
            results = [];
            selectedIndex = -1;
            saveState();
            return;
        }

        results = resultsList;
        resultsList.forEach((file, index) => {
            const item = document.createElement('div');
            item.className = 'result-item';
            item.dataset.uri = file.uri;
            if (index === selectedIndex) {
                item.classList.add('selected');
            }

            const label = document.createElement('div');
            label.className = 'result-label';
            label.innerHTML = highlightMatch(file.label, searchInput.value);

            const description = document.createElement('div');
            description.className = 'result-description';
            description.textContent = file.description;
            
            item.appendChild(label);
            item.appendChild(description);

            item.addEventListener('click', () => {
                selectedIndex = index;
                // Provide click feedback
                const currentlyClicked = document.querySelector('.result-item.clicked');
                if (currentlyClicked) {
                    currentlyClicked.classList.remove('clicked');
                }
                item.classList.add('clicked');
                
                // Send message to open the file
                openFile(item.dataset.uri);
            });
            resultsContainer.appendChild(item);
        });
        saveState();
    }

    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'results':
                selectedIndex = -1; // Reset selection on new results
                allResults = message.results || [];
                applyFilter(); // Apply filter to new results
                break;
            case 'focus':
                searchInput.focus();
                break;
        }
    });

}());