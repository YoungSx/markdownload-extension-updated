function notifyExtension() {
    // send a message that the content should be clipped
    browser.runtime.sendMessage({ type: "clip", dom: content});
}

function shouldSkipHiddenContent(captureOptions = {}) {
    return captureOptions?.skipHiddenContent === true;
}

function getHTMLOfDocument(captureOptions = {}) {
    const clonedDocument = document.implementation.createHTMLDocument('');
    const clonedHtml = document.documentElement.cloneNode(true);
    clonedDocument.replaceChild(clonedHtml, clonedDocument.documentElement);

    // make sure a title tag exists so that pageTitle is not empty and
    // a filename can be generated.
    if (clonedDocument.head.getElementsByTagName('title').length === 0) {
        const titleEl = clonedDocument.createElement('title');
        // prepare a good default text (the text displayed in the window title)
        titleEl.innerText = document.title;
        clonedDocument.head.append(titleEl);
    }

    // if the document doesn't have a "base" element make one
    // this allows the DOM parser in future steps to fix relative uris
    const baseEls = clonedDocument.head.getElementsByTagName('base');
    let baseEl;

    if (baseEls.length > 0) {
        baseEl = baseEls[0];
    } else {
        baseEl = clonedDocument.createElement('base');
        clonedDocument.head.append(baseEl);
    }

    // make sure the 'base' element always has a good 'href'
    // attribute so that the DOMParser generates usable
    // baseURI and documentURI properties when used in the
    // background context.
    const href = baseEl.getAttribute('href');

    if (!href || !href.startsWith(window.location.origin)) {
        baseEl.setAttribute('href', window.location.href);
    }

    // remove hidden content from the cloned page only
    if (shouldSkipHiddenContent(captureOptions) && document.body && clonedDocument.body) {
        removeHiddenNodes(document.body, clonedDocument.body);
    }

    // get the cloned page content as a string
    return clonedDocument.documentElement.outerHTML;
}

// code taken from here: https://www.reddit.com/r/javascript/comments/27bcao/anyone_have_a_method_for_finding_all_the_hidden/
function removeHiddenNodes(sourceRoot, clonedRoot) {
    const sourceChildren = Array.from(sourceRoot.children || []);
    const clonedChildren = Array.from(clonedRoot.children || []);

    for (let i = sourceChildren.length - 1; i >= 0; i--) {
        const sourceChild = sourceChildren[i];
        const clonedChild = clonedChildren[i];
        if (!sourceChild || !clonedChild) {
            continue;
        }

        const nodeName = sourceChild.nodeName.toLowerCase();
        if (nodeName === "script" || nodeName === "style" || nodeName === "noscript" || nodeName === "math") {
            continue;
        }

        if (sourceChild.offsetParent === void 0) {
            clonedChild.remove();
            continue;
        }

        const computedStyle = window.getComputedStyle(sourceChild, null);
        if (computedStyle.getPropertyValue("visibility") === "hidden" || computedStyle.getPropertyValue("display") === "none") {
            clonedChild.remove();
            continue;
        }

        removeHiddenNodes(sourceChild, clonedChild);
    }

    return clonedRoot;
}

// code taken from here: https://stackoverflow.com/a/5084044/304786
function getHTMLOfSelection() {
    var range;
    if (document.selection && document.selection.createRange) {
        range = document.selection.createRange();
        return range.htmlText;
    } else if (window.getSelection) {
        var selection = window.getSelection();
        if (selection.rangeCount > 0) {
            let content = '';
            for (let i = 0; i < selection.rangeCount; i++) {
                range = selection.getRangeAt(i);
                var clonedSelection = range.cloneContents();
                var div = document.createElement('div');
                div.appendChild(clonedSelection);
                content += div.innerHTML;
            }
            return content;
        } else {
            return '';
        }
    } else {
        return '';
	}
}

if (typeof window.marksnipCaptureState === 'undefined') {
    window.marksnipCaptureState = {
        pageContextLoadPromise: null,
        pageContextScriptLoaded: false,
        pageContextScriptFailed: false,
        lastPageContextFailureAt: 0,
        pageContextRetryCooldownMs: 5000,
        latexAttrName: 'marksnip-latex',
        mathJaxSyncEventName: 'marksnip:mathjax-sync',
        mathJaxSyncRequestEventName: 'marksnip:mathjax-sync-request'
    };
}

function hasRenderedMathJaxNodes() {
    return !!document.querySelector('mjx-container, .MathJax, script[id^="MathJax-Element-"]');
}

function hasLatexTaggedMath() {
    return !!document.querySelector(`[${window.marksnipCaptureState.latexAttrName}]`);
}

function requestMathJaxSyncFromPageContext() {
    try {
        window.dispatchEvent(new CustomEvent(window.marksnipCaptureState.mathJaxSyncRequestEventName));
    } catch (error) {
        // Ignore event dispatch failures across contexts.
    }
}

function loadPageContextScript() {
    if (window.marksnipCaptureState.pageContextScriptLoaded) {
        return Promise.resolve(true);
    }

    if (window.marksnipCaptureState.pageContextScriptFailed) {
        const elapsedSinceFailure = Date.now() - window.marksnipCaptureState.lastPageContextFailureAt;
        if (elapsedSinceFailure < window.marksnipCaptureState.pageContextRetryCooldownMs) {
            return Promise.resolve(false);
        }
        window.marksnipCaptureState.pageContextScriptFailed = false;
    }

    if (window.marksnipCaptureState.pageContextLoadPromise) {
        return window.marksnipCaptureState.pageContextLoadPromise;
    }

    if (typeof browser === 'undefined' || !browser.runtime?.getURL) {
        return Promise.resolve(false);
    }

    window.marksnipCaptureState.pageContextLoadPromise = new Promise((resolve) => {
        let settled = false;
        const settle = (value) => {
            if (settled) {
                return;
            }
            settled = true;
            if (!value) {
                // Allow retries on later captures.
                window.marksnipCaptureState.pageContextLoadPromise = null;
            }
            resolve(value);
        };

        const existingScript = document.querySelector('script[data-marksnip-page-context="true"]');
        if (existingScript) {
            if (existingScript.getAttribute('data-marksnip-page-context-loaded') === 'true') {
                window.marksnipCaptureState.pageContextScriptLoaded = true;
                settle(true);
                return;
            }

            if (existingScript.getAttribute('data-marksnip-page-context-failed') === 'true') {
                settle(false);
                return;
            }

            existingScript.addEventListener('load', () => {
                window.marksnipCaptureState.pageContextScriptLoaded = true;
                settle(true);
            }, { once: true });
            existingScript.addEventListener('error', () => {
                window.marksnipCaptureState.pageContextScriptFailed = true;
                window.marksnipCaptureState.lastPageContextFailureAt = Date.now();
                settle(false);
            }, { once: true });

            setTimeout(() => settle(false), 1000);
            return;
        }

        var script = document.createElement('script');
        script.src = browser.runtime.getURL('contentScript/pageContext.js');
        script.setAttribute('data-marksnip-page-context', 'true');
        script.onload = () => {
            window.marksnipCaptureState.pageContextScriptLoaded = true;
            window.marksnipCaptureState.pageContextScriptFailed = false;
            script.setAttribute('data-marksnip-page-context-loaded', 'true');
            settle(true);
        };
        script.onerror = () => {
            window.marksnipCaptureState.pageContextScriptFailed = true;
            window.marksnipCaptureState.lastPageContextFailureAt = Date.now();
            script.setAttribute('data-marksnip-page-context-failed', 'true');
            settle(false);
        };

        setTimeout(() => {
            if (!window.marksnipCaptureState.pageContextScriptLoaded) {
                settle(false);
            }
        }, 1000);

        (document.head || document.documentElement).appendChild(script);
    });

    return window.marksnipCaptureState.pageContextLoadPromise;
}

function delay(milliseconds) {
    return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function waitForMathJaxLatexTagging(timeoutMs = 1400, pollIntervalMs = 70) {
    if (hasLatexTaggedMath()) {
        return true;
    }

    if (!hasRenderedMathJaxNodes()) {
        return false;
    }

    let syncedAtLeastOnce = false;
    const syncListener = () => {
        syncedAtLeastOnce = true;
    };

    window.addEventListener(window.marksnipCaptureState.mathJaxSyncEventName, syncListener);

    try {
        const startedAt = Date.now();
        while (Date.now() - startedAt < timeoutMs) {
            requestMathJaxSyncFromPageContext();
            await delay(pollIntervalMs);

            if (hasLatexTaggedMath()) {
                return true;
            }

            // If we got a sync event and there are still no rendered MathJax nodes,
            // there is nothing to wait on for this capture pass.
            if (syncedAtLeastOnce && !hasRenderedMathJaxNodes()) {
                break;
            }
        }
    } finally {
        window.removeEventListener(window.marksnipCaptureState.mathJaxSyncEventName, syncListener);
    }

    return hasLatexTaggedMath();
}

async function marksnipPrepareForCapture() {
    try {
        if (!hasRenderedMathJaxNodes() && !hasLatexTaggedMath()) {
            return;
        }

        await loadPageContextScript();
        await waitForMathJaxLatexTagging();
    } catch (error) {
        console.debug('marksnipPrepareForCapture failed:', error);
    }
}

function getSelectionAndDom(captureOptions = {}) {
    try {
      const dom = getHTMLOfDocument(captureOptions);
      const selection = getHTMLOfSelection();
      
      if (!dom) {
        console.error('Failed to get document HTML');
        return null;
      }
      
      return {
        selection: selection,
        dom: dom,
        pageUrl: window.location.href
      };
    } catch (error) {
      console.error('Error in getSelectionAndDom:', error);
      return null;
    }
  }

function removeMarkSnipElementPickerArtifacts(root) {
    if (!root || root.nodeType !== Node.ELEMENT_NODE) {
        return;
    }

    const nodes = [root, ...Array.from(root.querySelectorAll('*'))];
    nodes.forEach(node => {
        if (node.getAttribute?.('data-marksnip-element-picker-ui') === 'true') {
            node.remove();
            return;
        }

        if (node.classList) {
            Array.from(node.classList).forEach(className => {
                if (className.startsWith('marksnip-element-picker-')) {
                    node.classList.remove(className);
                }
            });
            if (node.getAttribute('class') === '') {
                node.removeAttribute('class');
            }
        }
    });
}

function cleanElementCloneForMarkdown(sourceElement, clonedElement, captureOptions = {}) {
    if (!clonedElement || clonedElement.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }

    if (shouldSkipHiddenContent(captureOptions)) {
        removeHiddenNodes(sourceElement, clonedElement);
    }

    removeMarkSnipElementPickerArtifacts(clonedElement);

    clonedElement.querySelectorAll('script, style, noscript').forEach(node => node.remove());

    return clonedElement;
}

function getElementHtmlForMarkdown(clonedElement) {
    if (!clonedElement) {
        return '';
    }

    const tagName = String(clonedElement.tagName || '').toUpperCase();
    if (tagName === 'HTML') {
        return clonedElement.querySelector('body')?.innerHTML || clonedElement.innerHTML || '';
    }
    if (tagName === 'BODY') {
        return clonedElement.innerHTML || '';
    }

    return clonedElement.outerHTML || '';
}

function normalizeElementPickerText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function deriveElementPickerTitle(clonedElement) {
    const heading = clonedElement?.matches?.('h1,h2,h3,h4,h5,h6')
        ? clonedElement
        : clonedElement?.querySelector?.('h1,h2,h3,h4,h5,h6');
    const headingText = normalizeElementPickerText(heading?.textContent);
    if (headingText) {
        return headingText;
    }

    const accessibleLabel = normalizeElementPickerText(
        clonedElement?.getAttribute?.('aria-label') ||
        clonedElement?.getAttribute?.('alt') ||
        clonedElement?.getAttribute?.('title')
    );
    if (accessibleLabel) {
        return accessibleLabel;
    }

    const textFallback = normalizeElementPickerText(clonedElement?.textContent).slice(0, 80);
    return textFallback || document.title || 'Selected Element';
}

function getElementPickerLabel(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return '';
    }

    const tag = String(element.tagName || '').toLowerCase();
    const id = element.id ? `#${element.id}` : '';
    const classNames = Array.from(element.classList || [])
        .filter(className => !className.startsWith('marksnip-element-picker-'))
        .slice(0, 2)
        .map(className => `.${className}`)
        .join('');
    return `${tag}${id}${classNames}`;
}

function buildDomWithManualElement(elementHtml, captureOptions = {}) {
    const domString = getHTMLOfDocument(captureOptions);
    const parser = new DOMParser();
    const dom = parser.parseFromString(domString, 'text/html');

    if (dom.documentElement.nodeName === 'parsererror' || !dom.body) {
        return domString;
    }

    dom.querySelectorAll('[data-marksnip-element-picker-ui="true"]').forEach(node => node.remove());
    dom.body.innerHTML = elementHtml;
    return dom.documentElement.outerHTML;
}

function captureElementForMarkdown(element, captureOptions = {}) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return null;
    }

    const clonedElement = cleanElementCloneForMarkdown(
        element,
        element.cloneNode(true),
        captureOptions
    );
    const elementHtml = getElementHtmlForMarkdown(clonedElement);

    if (!elementHtml || !elementHtml.trim()) {
        return null;
    }

    return {
        dom: buildDomWithManualElement(elementHtml, captureOptions),
        elementHtml,
        elementTitle: deriveElementPickerTitle(clonedElement),
        elementLabel: getElementPickerLabel(element),
        pageUrl: window.location.href,
        documentTitle: document.title || '',
        capturedAt: new Date().toISOString()
    };
}

// This function must be called in a visible page, such as a browserAction popup
// or a content script. Calling it in a background page has no effect!
function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text);
    } else {
        // Fallback
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-999999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
    }
}

function downloadMarkdown(filename, text) {
    let datauri = `data:text/markdown;base64,${text}`;
    var link = document.createElement('a');
    link.download = filename;
    link.href = datauri;
    link.click();
}

function downloadImage(filename, url) {

    /* Link with a download attribute? CORS says no.
    var link = document.createElement('a');
    link.download = filename.substring(0, filename.lastIndexOf('.'));
    link.href = url;
    console.log(link);
    link.click();
    */

    /* Try via xhr? Blocked by CORS.
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, true);
    xhr.responseType = 'blob';
    xhr.onload = () => {
        console.log('onload!')
        var file = new Blob([xhr.response], {type: 'application/octet-stream'});
        var link = document.createElement('a');
        link.download = filename;//.substring(0, filename.lastIndexOf('.'));
        link.href = window.URL.createObjectURL(file);
        console.log(link);
        link.click();
    }
    xhr.send();
    */

    /* draw on canvas? Inscure operation
    let img = new Image();
    img.src = url;
    img.onload = () => {
        let canvas = document.createElement("canvas");
        let ctx = canvas.getContext("2d");
        canvas.width = img.width;
        canvas.height = img.height;
        ctx.drawImage(img, 0, 0);

        var link = document.createElement('a');
        const ext = filename.substring(filename.lastIndexOf('.'));
        link.download = filename;
        link.href = canvas.toDataURL(`image/png`);
        console.log(link);
        link.click();
    }
    */
}

loadPageContextScript();

// ===== Link Picker Feature =====

// Use var to allow redeclaration if script is injected multiple times
if (typeof window.linkPickerState === 'undefined') {
    window.linkPickerState = {
        active: false,
        selectedLinks: new Set(),
        selectedElements: new Set(),
        hoveredElement: null,
        controlPanel: null,
        styleElement: null,
        handlers: {}
    };
}

function markSnipMessage(key, substitutions, fallback) {
    return window.markSnipI18n?.t(key, substitutions, fallback) || fallback || key;
}

function markSnipI18nReady() {
    return window.markSnipI18n?.ready?.().catch(() => {}) || Promise.resolve();
}

// Listen for link picker activation message
if (!window.linkPickerMessageListenerAdded) {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "ACTIVATE_LINK_PICKER") {
            return initLinkPickerMode()
                .then(() => ({ success: true }))
                .catch((error) => {
                    console.error("Failed to activate link picker:", error);
                    return { success: false, error: String(error?.message || error) };
                });
        }
    });
    window.linkPickerMessageListenerAdded = true;
}

// Use var to allow redeclaration if the content script is injected multiple times.
var ACCENT_COLORS = {
    sage:  { dark: '#56735A', darker: '#3F5441', base: '#6B8E6F' },
    ocean: { dark: '#4A7A92', darker: '#385D6F', base: '#5B8FA8' },
    slate: { dark: '#56657A', darker: '#414D5C', base: '#6B7B8E' },
    rose:  { dark: '#965C5C', darker: '#7A4A4A', base: '#B07070' },
    amber: { dark: '#967840', darker: '#7A6030', base: '#B08E50' }
};

async function initLinkPickerMode() {
    if (window.linkPickerState.active) {
        console.log("Link picker already active");
        return;
    }

    window.linkPickerState.active = true;
    window.linkPickerState.selectedLinks = new Set();
    window.linkPickerState.selectedElements = new Set();
    window.linkPickerState.lastSelectedElement = null;

    await markSnipI18nReady();

    // Read accent color from storage
    let accentColors = ACCENT_COLORS.sage;
    try {
        const data = await browser.storage.sync.get('popupAccent');
        const accent = data.popupAccent || 'sage';
        accentColors = ACCENT_COLORS[accent] || ACCENT_COLORS.sage;
    } catch (e) { /* use default */ }

    window.linkPickerState.accentColors = accentColors;

    // Inject CSS styles
    injectLinkPickerStyles(accentColors);

    // Create control panel
    createControlPanel(accentColors);

    // Add event listeners
    setupLinkPickerEventListeners();

    console.log("Link picker mode activated");
}

function injectLinkPickerStyles(colors) {
    const base = colors.base;
    const dark = colors.dark;
    const darker = colors.darker;
    // Extract RGB from hex for rgba usage
    const hexToRgb = (hex) => {
        const r = parseInt(hex.slice(1,3), 16);
        const g = parseInt(hex.slice(3,5), 16);
        const b = parseInt(hex.slice(5,7), 16);
        return `${r}, ${g}, ${b}`;
    };
    const baseRgb = hexToRgb(base);
    const darkRgb = hexToRgb(dark);

    const styles = `
        /* Link Picker Overlay */
        .marksnip-link-picker-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.25);
            z-index: 999998;
            pointer-events: none;
        }

        /* Highlighted element */
        .marksnip-link-picker-highlight {
            outline: 2px solid ${base} !important;
            outline-offset: 3px !important;
            cursor: pointer !important;
            position: relative !important;
            box-shadow: 0 0 0 5px rgba(${baseRgb}, 0.18) !important;
            transition: outline 100ms ease, box-shadow 100ms ease !important;
        }

        /* Selected element */
        .marksnip-link-picker-selected {
            outline: 2px solid ${dark} !important;
            outline-offset: 3px !important;
            box-shadow: 0 0 0 5px rgba(${darkRgb}, 0.18) !important;
        }

        .marksnip-link-picker-selected::after {
            content: '✓';
            position: absolute;
            top: -10px;
            right: -10px;
            width: 20px;
            height: 20px;
            background: ${dark};
            color: white;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: bold;
            font-size: 13px;
            box-shadow: 0 1px 4px rgba(0, 0, 0, 0.25);
            z-index: 999999;
        }

        /* Tooltip */
        .marksnip-link-picker-tooltip {
            position: fixed;
            background: #292524;
            color: #FAFAF9;
            padding: 6px 11px;
            border-radius: 6px;
            font-size: 12px;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            pointer-events: none;
            z-index: 1000000;
            white-space: nowrap;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
            letter-spacing: 0.01em;
        }

        /* Control Panel — matches popup header gradient */
        .marksnip-link-picker-panel {
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: linear-gradient(150deg, ${darker} 0%, ${dark} 100%);
            border-radius: 12px;
            padding: 18px 20px 16px;
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35), 0 2px 8px rgba(0, 0, 0, 0.15);
            z-index: 1000001;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            min-width: 240px;
            border: 1px solid rgba(255, 255, 255, 0.1);
            /* GPU layer — prevents compositing glitches during animation */
            transform: translateZ(0);
            will-change: transform, opacity;
            animation: marksnip-slideUp 240ms ease-out both;
        }

        .marksnip-link-picker-panel-title {
            font-size: 12px;
            font-weight: 600;
            color: rgba(255, 255, 255, 0.9);
            margin-bottom: 3px;
            text-align: center;
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .marksnip-link-picker-panel-info {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.55);
            margin-bottom: 14px;
            text-align: center;
        }

        .marksnip-link-picker-panel-count {
            font-size: 28px;
            font-weight: 700;
            color: #ffffff;
            text-align: center;
            margin-bottom: 14px;
            display: block;
            transform-origin: center;
            text-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
        }

        .marksnip-link-picker-panel-count.marksnip-bump {
            animation: marksnip-countBump 220ms ease-out both;
        }

        .marksnip-link-picker-panel-buttons {
            display: flex;
            gap: 8px;
        }

        .marksnip-link-picker-btn {
            flex: 1;
            padding: 9px 14px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            font-family: inherit;
            /* No transition on transform during pulse/slide — prevents conflict */
            transition: background 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
        }

        /* Done — white pill on accent: clean contrast */
        .marksnip-link-picker-btn-done {
            background: rgba(255, 255, 255, 0.95);
            color: ${darker};
            border: 1px solid rgba(255, 255, 255, 0.4);
        }

        .marksnip-link-picker-btn-done:hover {
            background: ${base};
            color: white;
            box-shadow: 0 4px 14px rgba(0, 0, 0, 0.25);
        }

        .marksnip-link-picker-btn-done:active {
            background: ${dark};
            color: white;
            box-shadow: none;
        }

        .marksnip-link-picker-btn-done.marksnip-pulse {
            animation: marksnip-donePulse 380ms ease-out both;
        }

        /* Cancel — ghost on green */
        .marksnip-link-picker-btn-cancel {
            background: rgba(255, 255, 255, 0.12);
            color: rgba(255, 255, 255, 0.8);
            border: 1px solid rgba(255, 255, 255, 0.18);
        }

        .marksnip-link-picker-btn-cancel:hover {
            background: rgba(255, 255, 255, 0.2);
            color: #ffffff;
        }

        .marksnip-link-picker-instructions {
            font-size: 11px;
            color: rgba(255, 255, 255, 0.4);
            text-align: center;
            margin-top: 12px;
            line-height: 1.6;
        }

        /* Click ripple */
        .marksnip-click-ripple {
            position: fixed;
            border-radius: 50%;
            pointer-events: none;
            z-index: 1000002;
            transform: scale(0);
            animation: marksnip-rippleOut 480ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
        }

        /* Keyframes */
        @keyframes marksnip-slideUp {
            from { opacity: 0; transform: translateZ(0) translateY(16px); }
            to   { opacity: 1; transform: translateZ(0) translateY(0); }
        }

        @keyframes marksnip-rippleOut {
            0%   { transform: scale(0);   opacity: 0.7; }
            100% { transform: scale(1);   opacity: 0; }
        }

        @keyframes marksnip-donePulse {
            0%   { transform: scale(1); }
            40%  { transform: scale(1.1); }
            70%  { transform: scale(0.97); }
            100% { transform: scale(1); }
        }

        @keyframes marksnip-countBump {
            0%   { transform: scale(1); }
            50%  { transform: scale(1.25); }
            100% { transform: scale(1); }
        }

        @keyframes fadeIn {
            from { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
            to   { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }

        @keyframes fadeOut {
            from { opacity: 1; transform: translate(-50%, -50%) scale(1); }
            to   { opacity: 0; transform: translate(-50%, -50%) scale(0.95); }
        }
    `;

    window.linkPickerState.styleElement = document.createElement('style');
    window.linkPickerState.styleElement.textContent = styles;
    document.head.appendChild(window.linkPickerState.styleElement);

    // Create overlay
    const overlay = document.createElement('div');
    overlay.className = 'marksnip-link-picker-overlay';
    overlay.id = 'marksnip-link-picker-overlay';
    document.body.appendChild(overlay);
}

function createPanelText(className, text) {
    const element = document.createElement('div');
    element.className = className;
    element.textContent = text;
    return element;
}

function createLinkPickerButton(className, id, label, title) {
    const button = document.createElement('button');
    button.className = className;
    button.id = id;
    button.type = 'button';
    if (title) {
        button.title = title;
    }
    button.textContent = label;
    return button;
}

function createControlPanel(colors) {
    const panel = document.createElement('div');
    panel.className = 'marksnip-link-picker-panel';
    panel.id = 'marksnip-link-picker-panel';

    const title = createPanelText('marksnip-link-picker-panel-title', markSnipMessage('linkPickerTitle', null, 'Link Picker'));
    const info = createPanelText('marksnip-link-picker-panel-info', markSnipMessage('linkPickerHoverInfo', null, 'Hover over elements to find links'));
    const count = createPanelText('marksnip-link-picker-panel-count', markSnipMessage('linkPickerCountZero', null, '0 links'));
    count.id = 'marksnip-link-count';

    const primaryButtons = document.createElement('div');
    primaryButtons.className = 'marksnip-link-picker-panel-buttons';
    primaryButtons.appendChild(createLinkPickerButton(
        'marksnip-link-picker-btn marksnip-link-picker-btn-cancel',
        'marksnip-link-picker-cancel',
        markSnipMessage('linkPickerCancelBtn', null, 'Cancel')
    ));
    primaryButtons.appendChild(createLinkPickerButton(
        'marksnip-link-picker-btn marksnip-link-picker-btn-done',
        'marksnip-link-picker-done',
        markSnipMessage('linkPickerDoneBtn', null, 'Done')
    ));

    const secondaryButtons = document.createElement('div');
    secondaryButtons.className = 'marksnip-link-picker-panel-buttons';
    secondaryButtons.style.marginTop = '8px';
    secondaryButtons.appendChild(createLinkPickerButton(
        'marksnip-link-picker-btn marksnip-link-picker-btn-cancel',
        'marksnip-link-picker-undo',
        markSnipMessage('linkPickerUndoBtn', null, 'Undo'),
        markSnipMessage('linkPickerUndoTitle', null, 'Undo last selection')
    ));
    secondaryButtons.appendChild(createLinkPickerButton(
        'marksnip-link-picker-btn marksnip-link-picker-btn-cancel',
        'marksnip-link-picker-clear',
        markSnipMessage('linkPickerClearAllBtn', null, 'Clear All'),
        markSnipMessage('linkPickerClearAllTitle', null, 'Deselect all elements')
    ));

    const instructions = document.createElement('div');
    instructions.className = 'marksnip-link-picker-instructions';
    instructions.appendChild(document.createTextNode(markSnipMessage('linkPickerInstructionsClick', null, 'Click elements to select links')));
    instructions.appendChild(document.createElement('br'));
    instructions.appendChild(document.createTextNode(markSnipMessage('linkPickerInstructionsEsc', null, 'Press ESC to cancel')));

    panel.appendChild(title);
    panel.appendChild(info);
    panel.appendChild(count);
    panel.appendChild(primaryButtons);
    panel.appendChild(secondaryButtons);
    panel.appendChild(instructions);
    document.body.appendChild(panel);
    window.linkPickerState.controlPanel = panel;

    // Add button event listeners
    document.getElementById('marksnip-link-picker-done').addEventListener('click', finishLinkPicker);
    document.getElementById('marksnip-link-picker-cancel').addEventListener('click', cancelLinkPicker);
    document.getElementById('marksnip-link-picker-undo').addEventListener('click', undoLastSelection);
    document.getElementById('marksnip-link-picker-clear').addEventListener('click', clearAllSelections);
}

function setupLinkPickerEventListeners() {
    // Mouse move handler
    window.linkPickerState.handlers.mousemove = function(e) {
        // Ignore if hovering over control panel or its children
        if (e.target.closest('#marksnip-link-picker-panel')) {
            removeHighlight();
            return;
        }

        const element = e.target;

        // Don't highlight if it's our overlay or already selected
        if (element.id === 'marksnip-link-picker-overlay' ||
            window.linkPickerState.selectedElements.has(element)) {
            return;
        }

        highlightElement(element, e.clientX, e.clientY);
    };

    // Click handler
    window.linkPickerState.handlers.click = function(e) {
        // Ignore clicks on control panel
        if (e.target.closest('#marksnip-link-picker-panel')) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();

        const element = e.target;

        // Toggle selection — pass coords for the ripple
        if (window.linkPickerState.selectedElements.has(element)) {
            deselectElement(element, e.clientX, e.clientY);
        } else {
            selectElement(element, e.clientX, e.clientY);
        }
    };

    // Keyboard handler
    window.linkPickerState.handlers.keydown = function(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            cancelLinkPicker();
        }
    };

    // Add listeners
    document.addEventListener('mousemove', window.linkPickerState.handlers.mousemove, true);
    document.addEventListener('click', window.linkPickerState.handlers.click, true);
    document.addEventListener('keydown', window.linkPickerState.handlers.keydown, true);
}

function highlightElement(element, mouseX, mouseY) {
    // Remove previous highlight
    removeHighlight();

    // Don't highlight selected elements
    if (window.linkPickerState.selectedElements.has(element)) {
        return;
    }

    element.classList.add('marksnip-link-picker-highlight');
    window.linkPickerState.hoveredElement = element;

    // Count links in this element
    const linkCount = extractLinksFromElement(element).length;

    if (linkCount > 0) {
        const tooltipText = linkCount === 1
            ? markSnipMessage('linkPickerLinksFoundTooltipOne', null, '1 link found')
            : markSnipMessage('linkPickerLinksFoundTooltipMany', [linkCount], `${linkCount} links found`);
        showTooltip(tooltipText, mouseX, mouseY);
    } else {
        showTooltip(markSnipMessage('linkPickerNoLinksTooltip', null, 'No links in this element'), mouseX, mouseY);
    }
}

function removeHighlight() {
    if (window.linkPickerState.hoveredElement) {
        window.linkPickerState.hoveredElement.classList.remove('marksnip-link-picker-highlight');
        window.linkPickerState.hoveredElement = null;
    }
    removeTooltip();
}

function showTooltip(text, x, y) {
    removeTooltip();

    const tooltip = document.createElement('div');
    tooltip.className = 'marksnip-link-picker-tooltip';
    tooltip.id = 'marksnip-link-picker-tooltip';
    tooltip.textContent = text;
    tooltip.style.left = (x + 10) + 'px';
    tooltip.style.top = (y + 10) + 'px';
    document.body.appendChild(tooltip);
}

function removeTooltip() {
    const tooltip = document.getElementById('marksnip-link-picker-tooltip');
    if (tooltip) {
        tooltip.remove();
    }
}

function spawnClickRipple(x, y, color) {
    const size = 56;
    const ripple = document.createElement('div');
    ripple.className = 'marksnip-click-ripple';
    ripple.style.cssText = [
        `width: ${size}px`,
        `height: ${size}px`,
        `left: ${x - size / 2}px`,
        `top: ${y - size / 2}px`,
        `background: ${color}`,
    ].join(';');
    document.body.appendChild(ripple);
    ripple.addEventListener('animationend', () => ripple.remove(), { once: true });
}

function selectElement(element, clientX = 0, clientY = 0) {
    const links = extractLinksFromElement(element);

    if (links.length === 0) {
        // Still ripple — user clicked, just no links here
        spawnClickRipple(clientX, clientY, 'rgba(168, 162, 158, 0.45)');
        return;
    }

    // Add links to set
    links.forEach(link => window.linkPickerState.selectedLinks.add(link));

    // Mark element as selected
    window.linkPickerState.selectedElements.add(element);
    window.linkPickerState.lastSelectedElement = element;
    element.classList.remove('marksnip-link-picker-highlight');
    element.classList.add('marksnip-link-picker-selected');

    // Accent-colored ripple at cursor
    const ac = window.linkPickerState.accentColors || ACCENT_COLORS.sage;
    const hexToRgbInline = (hex) => `${parseInt(hex.slice(1,3),16)}, ${parseInt(hex.slice(3,5),16)}, ${parseInt(hex.slice(5,7),16)}`;
    spawnClickRipple(clientX, clientY, `rgba(${hexToRgbInline(ac.base)}, 0.4)`);

    updateLinkCount();
}

function deselectElement(element, clientX = 0, clientY = 0) {
    const links = extractLinksFromElement(element);

    // Remove links from set
    links.forEach(link => window.linkPickerState.selectedLinks.delete(link));

    // Unmark element
    window.linkPickerState.selectedElements.delete(element);
    element.classList.remove('marksnip-link-picker-selected');

    // Stone ripple (deselect)
    spawnClickRipple(clientX, clientY, 'rgba(168, 162, 158, 0.45)');

    updateLinkCount();
}

function undoLastSelection() {
    const last = window.linkPickerState.lastSelectedElement;
    if (last && window.linkPickerState.selectedElements.has(last)) {
        deselectElement(last);
        window.linkPickerState.lastSelectedElement = null;
    }
}

function clearAllSelections() {
    const elements = Array.from(window.linkPickerState.selectedElements);
    for (const el of elements) {
        deselectElement(el);
    }
    window.linkPickerState.lastSelectedElement = null;
}

function extractLinksFromElement(element) {
    const links = new Set();
    const anchors = Array.from(element.querySelectorAll('a[href]'));

    // Also check if the element itself is a link
    if (element.tagName === 'A' && element.href) {
        anchors.push(element);
    }

    anchors.forEach(a => {
        try {
            const href = a.getAttribute('href');
            if (!href) return;

            // Convert to absolute URL
            const absolute = new URL(href, window.location.href);

            // Filter out non-http(s) protocols
            if (absolute.protocol === 'http:' || absolute.protocol === 'https:') {
                links.add(absolute.href);
            }
        } catch (e) {
            // Invalid URL, skip
            console.debug('Invalid URL:', e);
        }
    });

    return Array.from(links);
}

function updateLinkCount() {
    const count = window.linkPickerState.selectedLinks.size;
    const countElement = document.getElementById('marksnip-link-count');
    const doneBtn = document.getElementById('marksnip-link-picker-done');

    if (countElement) {
        if (count === 0) {
            countElement.textContent = markSnipMessage('linkPickerCountZero', null, '0 links');
        } else if (count === 1) {
            countElement.textContent = markSnipMessage('linkPickerCountOne', null, '1 link');
        } else {
            countElement.textContent = markSnipMessage('linkPickerCountMany', [count], `${count} links`);
        }

        // Bump animation on count — retrigger by removing/re-adding the class
        countElement.classList.remove('marksnip-bump');
        // Force reflow so the browser registers the class removal
        void countElement.offsetWidth;
        countElement.classList.add('marksnip-bump');
    }

    if (doneBtn) {
        if (count === 1) {
            // First link selected — pulse the Done button to guide the user
            doneBtn.classList.remove('marksnip-pulse');
            void doneBtn.offsetWidth;
            doneBtn.classList.add('marksnip-pulse');
        } else if (count === 0) {
            doneBtn.classList.remove('marksnip-pulse');
        }
    }
}

function finishLinkPicker() {
    const links = Array.from(window.linkPickerState.selectedLinks);

    if (links.length === 0) {
        alert(markSnipMessage('popupAlertNoLinksSelected', null, 'No links selected. Please select elements containing links before clicking Done.'));
        return;
    }

    // Save links to storage so popup can retrieve them when it reopens
    browser.storage.local.set({
        linkPickerResults: links,
        linkPickerTimestamp: Date.now()
    }).then(() => {
        console.log(`Saved ${links.length} links to storage`);

        // Show success notification
        showSuccessNotification(links.length);

        // Also send message in case popup is still open
        browser.runtime.sendMessage({
            type: "LINK_PICKER_COMPLETE",
            links: links
        }).catch(err => {
            // Popup might be closed, that's okay - we saved to storage
            console.log("Popup closed, links saved to storage");
        });

        // Cleanup after a short delay so user can see the notification
        setTimeout(() => {
            cleanupLinkPicker();
        }, 2000);
    });
}

function showSuccessNotification(linkCount) {
    const ac = window.linkPickerState.accentColors || ACCENT_COLORS.sage;
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: linear-gradient(150deg, ${ac.darker} 0%, ${ac.dark} 100%);
        padding: 32px 48px;
        border-radius: 16px;
        box-shadow: 0 12px 48px rgba(0, 0, 0, 0.4);
        z-index: 10000000;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        text-align: center;
        border: 1px solid rgba(255, 255, 255, 0.12);
        animation: fadeIn 0.3s ease-out;
    `;
    const checkIcon = document.createElement('div');
    checkIcon.style.cssText = 'font-size: 44px; margin-bottom: 14px; line-height: 1;';
    checkIcon.textContent = '\u2713';

    const message = document.createElement('div');
    message.style.cssText = 'font-size: 18px; font-weight: 600; color: #ffffff; margin-bottom: 8px;';
    message.textContent = linkCount === 1
        ? markSnipMessage(
            'linkPickerCollectedNotificationOne',
            null,
            '1 link collected! Reopen the extension to add it to the batch processor'
        )
        : markSnipMessage(
            'linkPickerCollectedNotificationMany',
            [linkCount],
            `${linkCount} links collected! Reopen the extension to add them to the batch processor`
        );

    notification.appendChild(checkIcon);
    notification.appendChild(message);
    document.body.appendChild(notification);

    // Remove after 2 seconds
    setTimeout(() => {
        notification.style.animation = 'fadeOut 0.3s ease-out';
        setTimeout(() => notification.remove(), 300);
    }, 1700);
}

function cancelLinkPicker() {
    // Clear any stored results
    browser.storage.local.remove(['linkPickerResults', 'linkPickerTimestamp']).then(() => {
        // Also send message in case popup is still open
        browser.runtime.sendMessage({
            type: "LINK_PICKER_COMPLETE",
            links: []
        }).catch(err => {
            // Popup might be closed, that's okay
            console.log("Popup closed");
        });

        cleanupLinkPicker();
    });
}

function cleanupLinkPicker() {
    // Remove event listeners
    if (window.linkPickerState.handlers.mousemove) {
        document.removeEventListener('mousemove', window.linkPickerState.handlers.mousemove, true);
    }
    if (window.linkPickerState.handlers.click) {
        document.removeEventListener('click', window.linkPickerState.handlers.click, true);
    }
    if (window.linkPickerState.handlers.keydown) {
        document.removeEventListener('keydown', window.linkPickerState.handlers.keydown, true);
    }

    // Remove highlights from selected elements
    window.linkPickerState.selectedElements.forEach(element => {
        element.classList.remove('marksnip-link-picker-selected');
    });

    // Remove highlight from hovered element
    removeHighlight();

    // Remove control panel
    if (window.linkPickerState.controlPanel) {
        window.linkPickerState.controlPanel.remove();
    }

    // Remove overlay
    const overlay = document.getElementById('marksnip-link-picker-overlay');
    if (overlay) {
        overlay.remove();
    }

    // Remove styles
    if (window.linkPickerState.styleElement) {
        window.linkPickerState.styleElement.remove();
    }

    // Reset state
    window.linkPickerState = {
        active: false,
        selectedLinks: new Set(),
        selectedElements: new Set(),
        hoveredElement: null,
        controlPanel: null,
        styleElement: null,
        handlers: {},
        lastSelectedElement: null,
        accentColors: null
    };

    console.log("Link picker mode deactivated");
}

// ===== Element Picker Feature =====

if (typeof window.elementPickerState === 'undefined') {
    window.elementPickerState = {
        active: false,
        hoveredElement: null,
        selectedElement: null,
        previousSelectedElement: null,
        controlPanel: null,
        hoverBox: null,
        selectedBox: null,
        tooltip: null,
        styleElement: null,
        handlers: {},
        captureOptions: {},
        accentColors: null,
        converting: false
    };
}

if (!window.elementPickerMessageListenerAdded) {
    browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === "ACTIVATE_ELEMENT_PICKER") {
            return initElementPickerMode(message.captureOptions || {})
                .then(() => ({ success: true }))
                .catch((error) => {
                    console.error("Failed to activate element picker:", error);
                    return { success: false, error: String(error?.message || error) };
                });
        }
    });
    window.elementPickerMessageListenerAdded = true;
}

async function initElementPickerMode(captureOptions = {}) {
    if (window.elementPickerState.active) {
        return;
    }

    if (window.linkPickerState?.active && typeof cleanupLinkPicker === 'function') {
        cleanupLinkPicker();
    }

    await markSnipI18nReady();

    let accentColors = ACCENT_COLORS.sage;
    try {
        const data = await browser.storage.sync.get('popupAccent');
        const accent = data.popupAccent || 'sage';
        accentColors = ACCENT_COLORS[accent] || ACCENT_COLORS.sage;
    } catch (error) {
        accentColors = ACCENT_COLORS.sage;
    }

    window.elementPickerState = {
        active: true,
        hoveredElement: null,
        selectedElement: null,
        previousSelectedElement: null,
        controlPanel: null,
        hoverBox: null,
        selectedBox: null,
        tooltip: null,
        styleElement: null,
        handlers: {},
        captureOptions: {
            skipHiddenContent: captureOptions?.skipHiddenContent === true
        },
        accentColors,
        converting: false
    };

    injectElementPickerStyles(accentColors);
    createElementPickerChrome();
    setupElementPickerEventListeners();
    updateElementPickerPanel();
}

function injectElementPickerStyles(colors) {
    const base = colors.base;
    const dark = colors.dark;
    const darker = colors.darker;
    const hexToRgb = (hex) => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return `${r}, ${g}, ${b}`;
    };
    const baseRgb = hexToRgb(base);
    const darkRgb = hexToRgb(dark);

    const styles = `
        .marksnip-element-picker-box {
            position: fixed;
            z-index: 1000000;
            pointer-events: none;
            border-radius: 5px;
            box-sizing: border-box;
            opacity: 0;
            transform: translateZ(0);
            transition: opacity 140ms cubic-bezier(0.23, 1, 0.32, 1), border-color 140ms cubic-bezier(0.23, 1, 0.32, 1), box-shadow 140ms cubic-bezier(0.23, 1, 0.32, 1);
        }

        .marksnip-element-picker-hover-box {
            border: 2px solid ${base};
            background: rgba(${baseRgb}, 0.08);
            box-shadow: 0 0 0 4px rgba(${baseRgb}, 0.16);
        }

        .marksnip-element-picker-selected-box {
            border: 2px solid ${dark};
            background: rgba(${darkRgb}, 0.1);
            box-shadow: 0 0 0 5px rgba(${darkRgb}, 0.18), inset 0 0 0 1px rgba(255, 255, 255, 0.35);
        }

        .marksnip-element-picker-box.is-visible {
            opacity: 1;
        }

        .marksnip-element-picker-tooltip {
            position: fixed;
            z-index: 1000001;
            pointer-events: none;
            max-width: min(360px, calc(100vw - 32px));
            padding: 6px 10px;
            border-radius: 6px;
            background: #292524;
            color: #FAFAF9;
            font: 12px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.3);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            opacity: 0;
            transform: translateY(4px);
            transition: opacity 120ms cubic-bezier(0.23, 1, 0.32, 1), transform 120ms cubic-bezier(0.23, 1, 0.32, 1);
        }

        .marksnip-element-picker-tooltip.is-visible {
            opacity: 1;
            transform: translateY(0);
        }

        .marksnip-element-picker-panel {
            position: fixed;
            right: 24px;
            bottom: 24px;
            z-index: 1000002;
            width: min(320px, calc(100vw - 32px));
            padding: 16px;
            border-radius: 12px;
            border: 1px solid rgba(255, 255, 255, 0.12);
            background: linear-gradient(150deg, ${darker} 0%, ${dark} 100%);
            color: #ffffff;
            box-shadow: 0 18px 48px rgba(0, 0, 0, 0.34), 0 3px 12px rgba(0, 0, 0, 0.18);
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            transform: translateZ(0) translateY(0);
            animation: marksnipElementPickerIn 180ms cubic-bezier(0.23, 1, 0.32, 1) both;
        }

        .marksnip-element-picker-title {
            margin: 0 0 4px;
            font-size: 13px;
            line-height: 1.3;
            font-weight: 700;
        }

        .marksnip-element-picker-status {
            min-height: 34px;
            margin: 0 0 12px;
            color: rgba(255, 255, 255, 0.72);
            font-size: 12px;
            line-height: 1.45;
        }

        .marksnip-element-picker-target {
            color: #ffffff;
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            word-break: break-word;
        }

        .marksnip-element-picker-buttons {
            display: grid;
            grid-template-columns: repeat(2, minmax(0, 1fr));
            gap: 8px;
        }

        .marksnip-element-picker-btn {
            min-height: 34px;
            border-radius: 8px;
            border: 1px solid rgba(255, 255, 255, 0.18);
            padding: 8px 10px;
            color: rgba(255, 255, 255, 0.9);
            background: rgba(255, 255, 255, 0.12);
            font: 600 12px/1.2 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            cursor: pointer;
            transition: background-color 140ms cubic-bezier(0.23, 1, 0.32, 1), color 140ms cubic-bezier(0.23, 1, 0.32, 1), transform 120ms cubic-bezier(0.23, 1, 0.32, 1), opacity 140ms cubic-bezier(0.23, 1, 0.32, 1);
        }

        .marksnip-element-picker-btn:hover {
            background: rgba(255, 255, 255, 0.2);
            color: #ffffff;
        }

        .marksnip-element-picker-btn:active {
            transform: scale(0.97);
        }

        .marksnip-element-picker-btn:focus-visible {
            outline: 2px solid rgba(255, 255, 255, 0.86);
            outline-offset: 2px;
        }

        .marksnip-element-picker-btn:disabled {
            cursor: not-allowed;
            opacity: 0.45;
            transform: none;
        }

        .marksnip-element-picker-btn-primary {
            background: rgba(255, 255, 255, 0.95);
            color: ${darker};
            border-color: rgba(255, 255, 255, 0.44);
        }

        .marksnip-element-picker-btn-primary:hover {
            background: ${base};
            color: #ffffff;
        }

        .marksnip-element-picker-success {
            position: fixed;
            left: 50%;
            top: 50%;
            z-index: 1000003;
            max-width: min(420px, calc(100vw - 40px));
            padding: 20px 24px;
            border-radius: 14px;
            background: linear-gradient(150deg, ${darker} 0%, ${dark} 100%);
            color: #ffffff;
            box-shadow: 0 18px 52px rgba(0, 0, 0, 0.36);
            font: 600 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            text-align: center;
            transform: translate(-50%, -50%) scale(0.96);
            opacity: 0;
            animation: marksnipElementPickerSuccess 180ms cubic-bezier(0.23, 1, 0.32, 1) forwards;
        }

        @keyframes marksnipElementPickerIn {
            from { opacity: 0; transform: translateZ(0) translateY(12px); }
            to { opacity: 1; transform: translateZ(0) translateY(0); }
        }

        @keyframes marksnipElementPickerSuccess {
            to { opacity: 1; transform: translate(-50%, -50%) scale(1); }
        }

        @media (prefers-reduced-motion: reduce) {
            .marksnip-element-picker-box,
            .marksnip-element-picker-tooltip,
            .marksnip-element-picker-panel,
            .marksnip-element-picker-success,
            .marksnip-element-picker-btn {
                animation: none !important;
                transition-duration: 0.01ms !important;
                transform: none;
            }

            .marksnip-element-picker-success {
                transform: translate(-50%, -50%);
            }
        }
    `;

    window.elementPickerState.styleElement = document.createElement('style');
    window.elementPickerState.styleElement.textContent = styles;
    window.elementPickerState.styleElement.setAttribute('data-marksnip-element-picker-ui', 'true');
    document.head.appendChild(window.elementPickerState.styleElement);
}

function createElementPickerChrome() {
    const hoverBox = document.createElement('div');
    hoverBox.className = 'marksnip-element-picker-box marksnip-element-picker-hover-box';
    hoverBox.setAttribute('data-marksnip-element-picker-ui', 'true');

    const selectedBox = document.createElement('div');
    selectedBox.className = 'marksnip-element-picker-box marksnip-element-picker-selected-box';
    selectedBox.setAttribute('data-marksnip-element-picker-ui', 'true');

    const tooltip = document.createElement('div');
    tooltip.className = 'marksnip-element-picker-tooltip';
    tooltip.setAttribute('data-marksnip-element-picker-ui', 'true');

    const panel = document.createElement('div');
    panel.className = 'marksnip-element-picker-panel';
    panel.id = 'marksnip-element-picker-panel';
    panel.setAttribute('data-marksnip-element-picker-ui', 'true');
    panel.innerHTML = `
        <p class="marksnip-element-picker-title"></p>
        <p class="marksnip-element-picker-status" id="marksnip-element-picker-status"></p>
        <div class="marksnip-element-picker-buttons">
            <button class="marksnip-element-picker-btn" id="marksnip-element-picker-parent" type="button"></button>
            <button class="marksnip-element-picker-btn" id="marksnip-element-picker-child" type="button"></button>
            <button class="marksnip-element-picker-btn" id="marksnip-element-picker-reselect" type="button"></button>
            <button class="marksnip-element-picker-btn" id="marksnip-element-picker-cancel" type="button"></button>
            <button class="marksnip-element-picker-btn marksnip-element-picker-btn-primary" id="marksnip-element-picker-done" type="button"></button>
        </div>
    `;

    panel.querySelector('.marksnip-element-picker-title').textContent = markSnipMessage('elementPickerTitle', null, 'Element Picker');
    panel.querySelector('#marksnip-element-picker-parent').textContent = markSnipMessage('elementPickerParentBtn', null, 'Parent');
    panel.querySelector('#marksnip-element-picker-child').textContent = markSnipMessage('elementPickerChildBtn', null, 'Child');
    panel.querySelector('#marksnip-element-picker-reselect').textContent = markSnipMessage('elementPickerReselectBtn', null, 'Reselect');
    panel.querySelector('#marksnip-element-picker-cancel').textContent = markSnipMessage('elementPickerCancelBtn', null, 'Cancel');
    panel.querySelector('#marksnip-element-picker-done').textContent = markSnipMessage('elementPickerDoneBtn', null, 'Done');

    document.body.appendChild(hoverBox);
    document.body.appendChild(selectedBox);
    document.body.appendChild(tooltip);
    document.body.appendChild(panel);

    window.elementPickerState.hoverBox = hoverBox;
    window.elementPickerState.selectedBox = selectedBox;
    window.elementPickerState.tooltip = tooltip;
    window.elementPickerState.controlPanel = panel;

    panel.querySelector('#marksnip-element-picker-parent').addEventListener('click', selectElementPickerParent);
    panel.querySelector('#marksnip-element-picker-child').addEventListener('click', selectElementPickerChild);
    panel.querySelector('#marksnip-element-picker-reselect').addEventListener('click', reselectElementPickerTarget);
    panel.querySelector('#marksnip-element-picker-cancel').addEventListener('click', cancelElementPicker);
    panel.querySelector('#marksnip-element-picker-done').addEventListener('click', finishElementPicker);
}

function setupElementPickerEventListeners() {
    window.elementPickerState.handlers.mousemove = function(e) {
        if (isElementPickerUi(e.target)) {
            hideElementPickerHover();
            return;
        }

        const element = getPickableElement(e.target);
        if (!element) {
            hideElementPickerHover();
            return;
        }

        window.elementPickerState.hoveredElement = element;
        updateElementPickerBox(window.elementPickerState.hoverBox, element);
        updateElementPickerTooltip(element, e.clientX, e.clientY);
    };

    window.elementPickerState.handlers.click = function(e) {
        if (isElementPickerUi(e.target)) {
            return;
        }

        const element = getPickableElement(e.target);
        if (!element) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        selectElementPickerTarget(element);
    };

    window.elementPickerState.handlers.keydown = function(e) {
        if (e.key === 'Escape') {
            e.preventDefault();
            cancelElementPicker();
        } else if (e.key === 'Enter' && window.elementPickerState.selectedElement) {
            e.preventDefault();
            finishElementPicker();
        }
    };

    window.elementPickerState.handlers.reposition = function() {
        if (window.elementPickerState.hoveredElement) {
            updateElementPickerBox(window.elementPickerState.hoverBox, window.elementPickerState.hoveredElement);
        }
        if (window.elementPickerState.selectedElement) {
            updateElementPickerBox(window.elementPickerState.selectedBox, window.elementPickerState.selectedElement);
        }
    };

    document.addEventListener('mousemove', window.elementPickerState.handlers.mousemove, true);
    document.addEventListener('click', window.elementPickerState.handlers.click, true);
    document.addEventListener('keydown', window.elementPickerState.handlers.keydown, true);
    window.addEventListener('scroll', window.elementPickerState.handlers.reposition, true);
    window.addEventListener('resize', window.elementPickerState.handlers.reposition, true);
}

function isElementPickerUi(element) {
    return !!element?.closest?.('[data-marksnip-element-picker-ui="true"]');
}

function isPickableElement(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) {
        return false;
    }
    if (isElementPickerUi(element)) {
        return false;
    }
    if (element === document.documentElement) {
        return true;
    }
    return !!document.body?.contains(element);
}

function getPickableElement(element) {
    let current = element;
    while (current && current !== document) {
        if (isPickableElement(current)) {
            return current;
        }
        current = current.parentElement;
    }
    return null;
}

function updateElementPickerBox(box, element) {
    if (!box || !element) {
        return;
    }

    const rect = element.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);

    box.style.left = `${Math.max(0, rect.left)}px`;
    box.style.top = `${Math.max(0, rect.top)}px`;
    box.style.width = `${width}px`;
    box.style.height = `${height}px`;
    box.classList.add('is-visible');
}

function hideElementPickerHover() {
    window.elementPickerState.hoveredElement = null;
    window.elementPickerState.hoverBox?.classList.remove('is-visible');
    window.elementPickerState.tooltip?.classList.remove('is-visible');
}

function updateElementPickerTooltip(element, x, y) {
    const tooltip = window.elementPickerState.tooltip;
    if (!tooltip) {
        return;
    }

    const rect = element.getBoundingClientRect();
    const label = getElementPickerLabel(element) || markSnipMessage('elementPickerUnknownElement', null, 'element');
    tooltip.textContent = `${label} - ${Math.round(rect.width)} x ${Math.round(rect.height)}`;

    const margin = 12;
    const left = Math.min(window.innerWidth - 24, x + margin);
    const top = Math.min(window.innerHeight - 32, y + margin);
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
    tooltip.classList.add('is-visible');
}

function getBestChildElement(element) {
    const children = Array.from(element?.children || [])
        .filter(child => !isElementPickerUi(child));

    if (window.elementPickerState.hoveredElement &&
        element.contains(window.elementPickerState.hoveredElement) &&
        window.elementPickerState.hoveredElement !== element) {
        return window.elementPickerState.hoveredElement;
    }

    let bestChild = null;
    let bestArea = 0;
    children.forEach(child => {
        const rect = child.getBoundingClientRect();
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        if (area > bestArea) {
            bestArea = area;
            bestChild = child;
        }
    });

    return bestChild;
}

function selectElementPickerTarget(element) {
    if (!isPickableElement(element)) {
        return;
    }

    window.elementPickerState.previousSelectedElement = window.elementPickerState.selectedElement;
    window.elementPickerState.selectedElement = element;
    updateElementPickerBox(window.elementPickerState.selectedBox, element);
    updateElementPickerPanel();
}

function selectElementPickerParent() {
    const current = window.elementPickerState.selectedElement;
    const parent = current?.parentElement;
    if (parent && isPickableElement(parent)) {
        selectElementPickerTarget(parent);
    }
}

function selectElementPickerChild() {
    const child = getBestChildElement(window.elementPickerState.selectedElement);
    if (child && isPickableElement(child)) {
        selectElementPickerTarget(child);
    }
}

function reselectElementPickerTarget() {
    window.elementPickerState.selectedElement = null;
    window.elementPickerState.previousSelectedElement = null;
    window.elementPickerState.selectedBox?.classList.remove('is-visible');
    updateElementPickerPanel();
}

function updateElementPickerPanel() {
    const selected = window.elementPickerState.selectedElement;
    const panel = window.elementPickerState.controlPanel;
    if (!panel) {
        return;
    }

    const status = panel.querySelector('#marksnip-element-picker-status');
    const parentButton = panel.querySelector('#marksnip-element-picker-parent');
    const childButton = panel.querySelector('#marksnip-element-picker-child');
    const reselectButton = panel.querySelector('#marksnip-element-picker-reselect');
    const doneButton = panel.querySelector('#marksnip-element-picker-done');

    if (selected) {
        const label = getElementPickerLabel(selected);
        status.innerHTML = '';
        status.appendChild(document.createTextNode(markSnipMessage('elementPickerSelectedPrefix', null, 'Selected: ')));
        const target = document.createElement('span');
        target.className = 'marksnip-element-picker-target';
        target.textContent = label || markSnipMessage('elementPickerUnknownElement', null, 'element');
        status.appendChild(target);
    } else {
        status.textContent = markSnipMessage('elementPickerHoverInfo', null, 'Hover and click an element to convert it to Markdown.');
    }

    if (parentButton) {
        parentButton.disabled = !selected?.parentElement || !isPickableElement(selected.parentElement);
    }
    if (childButton) {
        childButton.disabled = !getBestChildElement(selected);
    }
    if (reselectButton) {
        reselectButton.disabled = !selected;
    }
    if (doneButton) {
        doneButton.disabled = !selected || window.elementPickerState.converting;
    }
}

function setElementPickerStatus(text) {
    const status = window.elementPickerState.controlPanel?.querySelector('#marksnip-element-picker-status');
    if (status) {
        status.textContent = text;
    }
}

async function finishElementPicker() {
    const selected = window.elementPickerState.selectedElement;
    if (!selected || window.elementPickerState.converting) {
        return;
    }

    window.elementPickerState.converting = true;
    updateElementPickerPanel();
    setElementPickerStatus(markSnipMessage('elementPickerConverting', null, 'Converting selected element...'));

    try {
        if (typeof marksnipPrepareForCapture === 'function') {
            await marksnipPrepareForCapture();
        }

        const payload = captureElementForMarkdown(selected, window.elementPickerState.captureOptions);
        if (!payload) {
            throw new Error(markSnipMessage('elementPickerEmptyError', null, 'The selected element did not contain convertible content.'));
        }

        const result = await browser.runtime.sendMessage({
            type: 'element-picker-convert',
            payload
        });

        if (!result?.ok) {
            throw new Error(result?.error || markSnipMessage('elementPickerFailedError', null, 'Element conversion failed.'));
        }

        const successMessage = result.action === 'copy'
            ? markSnipMessage('elementPickerCopySuccess', null, 'Element Markdown copied to clipboard.')
            : markSnipMessage('elementPickerSuccess', null, 'Element converted. Open MarkSnip to review.');
        showElementPickerSuccess(successMessage);
        setTimeout(() => cleanupElementPicker(), 1400);
    } catch (error) {
        console.error('Element picker conversion failed:', error);
        window.elementPickerState.converting = false;
        updateElementPickerPanel();
        setElementPickerStatus(error?.message || markSnipMessage('elementPickerFailedError', null, 'Element conversion failed.'));
    }
}

function showElementPickerSuccess(message) {
    const notification = document.createElement('div');
    notification.className = 'marksnip-element-picker-success';
    notification.setAttribute('data-marksnip-element-picker-ui', 'true');
    notification.textContent = message || markSnipMessage('elementPickerSuccess', null, 'Element converted. Open MarkSnip to review.');
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 2400);
}

function cancelElementPicker() {
    cleanupElementPicker();
}

function cleanupElementPicker() {
    const handlers = window.elementPickerState.handlers || {};
    if (handlers.mousemove) {
        document.removeEventListener('mousemove', handlers.mousemove, true);
    }
    if (handlers.click) {
        document.removeEventListener('click', handlers.click, true);
    }
    if (handlers.keydown) {
        document.removeEventListener('keydown', handlers.keydown, true);
    }
    if (handlers.reposition) {
        window.removeEventListener('scroll', handlers.reposition, true);
        window.removeEventListener('resize', handlers.reposition, true);
    }

    window.elementPickerState.hoverBox?.remove();
    window.elementPickerState.selectedBox?.remove();
    window.elementPickerState.tooltip?.remove();
    window.elementPickerState.controlPanel?.remove();
    window.elementPickerState.styleElement?.remove();

    window.elementPickerState = {
        active: false,
        hoveredElement: null,
        selectedElement: null,
        previousSelectedElement: null,
        controlPanel: null,
        hoverBox: null,
        selectedBox: null,
        tooltip: null,
        styleElement: null,
        handlers: {},
        captureOptions: {},
        accentColors: null,
        converting: false
    };
}
