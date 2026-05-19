const fs = require('fs');
const path = require('path');

describe('Content Script DOM Capture', () => {
  beforeAll(() => {
    const scriptPath = path.join(__dirname, '../../contentScript/contentScript.js');
    const scriptSource = fs.readFileSync(scriptPath, 'utf8');
    window.eval(scriptSource);
  });

  beforeEach(() => {
    document.documentElement.innerHTML = `
      <head></head>
      <body>
        <main id="root">
          <img id="visible-img" src="/visible.png">
          <img id="hidden-img" src="/hidden.png" style="display: none;">
          <div id="hidden-div" style="visibility: hidden;">Hidden text</div>
          <div id="visible-div">Visible text</div>
        </main>
      </body>
    `;
  });

  test('getSelectionAndDom should not mutate the live document', () => {
    const beforeOuterHTML = document.documentElement.outerHTML;
    const beforeTitleCount = document.head.querySelectorAll('title').length;
    const beforeBaseCount = document.head.querySelectorAll('base').length;
    const beforeHiddenImage = document.getElementById('hidden-img');

    const result = getSelectionAndDom();

    expect(result).toBeTruthy();
    expect(result.dom).toBeTruthy();
    expect(document.documentElement.outerHTML).toBe(beforeOuterHTML);
    expect(document.head.querySelectorAll('title').length).toBe(beforeTitleCount);
    expect(document.head.querySelectorAll('base').length).toBe(beforeBaseCount);
    expect(document.getElementById('hidden-img')).toBe(beforeHiddenImage);
  });

  test('captured DOM should be cleaned while live DOM stays intact when hidden-content skipping is enabled', () => {
    const result = getSelectionAndDom({ skipHiddenContent: true });
    const parser = new DOMParser();
    const capturedDocument = parser.parseFromString(result.dom, 'text/html');

    expect(capturedDocument.getElementById('hidden-img')).toBeNull();
    expect(capturedDocument.getElementById('hidden-div')).toBeNull();
    expect(capturedDocument.getElementById('visible-img')).toBeTruthy();
    expect(capturedDocument.getElementById('visible-div')).toBeTruthy();
    expect(document.getElementById('hidden-img')).toBeTruthy();
    expect(document.getElementById('hidden-div')).toBeTruthy();
    expect(document.head.querySelector('base')).toBeNull();
  });

  test('captured DOM retains hidden content by default', () => {
    const result = getSelectionAndDom();
    const parser = new DOMParser();
    const capturedDocument = parser.parseFromString(result.dom, 'text/html');

    expect(capturedDocument.getElementById('hidden-img')).toBeTruthy();
    expect(capturedDocument.getElementById('hidden-div')).toBeTruthy();
    expect(capturedDocument.getElementById('visible-img')).toBeTruthy();
    expect(capturedDocument.getElementById('visible-div')).toBeTruthy();
  });

  test('captured DOM can retain hidden content when hidden-content skipping is disabled', () => {
    const result = getSelectionAndDom({ skipHiddenContent: false });
    const parser = new DOMParser();
    const capturedDocument = parser.parseFromString(result.dom, 'text/html');

    expect(capturedDocument.getElementById('hidden-img')).toBeTruthy();
    expect(capturedDocument.getElementById('hidden-div')).toBeTruthy();
    expect(capturedDocument.getElementById('visible-img')).toBeTruthy();
    expect(capturedDocument.getElementById('visible-div')).toBeTruthy();
  });

  test('manual element capture serializes only the selected element body', () => {
    const selected = document.getElementById('visible-div');
    selected.innerHTML = '<h2>Manual Capture Heading</h2><p>Manual body text.</p>';

    const result = captureElementForMarkdown(selected);
    const parser = new DOMParser();
    const capturedDocument = parser.parseFromString(result.dom, 'text/html');

    expect(result.elementTitle).toBe('Manual Capture Heading');
    expect(result.elementLabel).toBe('div#visible-div');
    expect(capturedDocument.body.textContent).toContain('Manual body text.');
    expect(capturedDocument.getElementById('visible-div')).toBeTruthy();
    expect(capturedDocument.getElementById('root')).toBeNull();
  });

  test('manual element capture removes hidden descendants when requested', () => {
    const selected = document.getElementById('root');

    const result = captureElementForMarkdown(selected, { skipHiddenContent: true });
    const parser = new DOMParser();
    const capturedDocument = parser.parseFromString(result.dom, 'text/html');

    expect(capturedDocument.getElementById('hidden-img')).toBeNull();
    expect(capturedDocument.getElementById('hidden-div')).toBeNull();
    expect(capturedDocument.getElementById('visible-img')).toBeTruthy();
    expect(capturedDocument.getElementById('visible-div')).toBeTruthy();
  });

  test('manual body capture excludes element picker chrome', () => {
    const pickerChrome = document.createElement('div');
    pickerChrome.setAttribute('data-marksnip-element-picker-ui', 'true');
    pickerChrome.textContent = 'Picker controls should not be captured';
    document.body.appendChild(pickerChrome);

    const result = captureElementForMarkdown(document.body);
    const parser = new DOMParser();
    const capturedDocument = parser.parseFromString(result.dom, 'text/html');

    expect(capturedDocument.body.textContent).toContain('Visible text');
    expect(capturedDocument.body.textContent).not.toContain('Picker controls should not be captured');
    expect(capturedDocument.querySelector('[data-marksnip-element-picker-ui="true"]')).toBeNull();
  });

  test('marksnipPrepareForCapture should request MathJax sync for rendered nodes', async () => {
    const mathNode = document.createElement('mjx-container');
    document.getElementById('visible-div').appendChild(mathNode);

    window.marksnipCaptureState.pageContextScriptLoaded = true;
    window.marksnipCaptureState.pageContextLoadPromise = Promise.resolve(true);

    window.addEventListener(window.marksnipCaptureState.mathJaxSyncRequestEventName, () => {
      mathNode.setAttribute('marksnip-latex', 'E=mc^2');
      window.dispatchEvent(new CustomEvent(window.marksnipCaptureState.mathJaxSyncEventName, {
        detail: { taggedCount: 1 }
      }));
    }, { once: true });

    await marksnipPrepareForCapture();

    expect(mathNode.getAttribute('marksnip-latex')).toBe('E=mc^2');
  });
});
