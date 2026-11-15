import { compileTemplates, translateCatalog } from './i18n-catalog.js';

// Register a language here and add its JSON catalog; English phrases are the source keys.
const languages = { en: 'EN', ru: 'RU' };
const catalogs = { en: {} };
const templates = {};
let language = 'en';
let preferredLanguage = 'en';
try { preferredLanguage = localStorage.getItem('aniimax-language') || 'en'; } catch (_) { /* Private browsing can disable storage. */ }
if (!Object.hasOwn(languages, preferredLanguage)) preferredLanguage = 'en';

async function load(code) {
    if (!catalogs[code]) {
        const response = await fetch(new URL(`./locales/${code}.json${new URL(import.meta.url).search}`, import.meta.url));
        if (!response.ok) throw new Error(`Could not load ${code} translations`);
        catalogs[code] = await response.json();
        templates[code] = compileTemplates(catalogs[code]);
    }
}

const textSources = new WeakMap();
const attributeSources = new WeakMap();
const attributes = ['title', 'aria-label', 'aria-description', 'placeholder', 'data-label', 'data-tooltip', 'data-tip', 'data-tip-detail', 'data-tip-stats', 'data-tip-text', 'data-help'];

export function translate(value) {
    return language === 'en' ? value : translateCatalog(value, catalogs[language], templates[language]);
}

export function currentLocale() {
    return language === 'ru' ? 'ru-RU' : 'en-US';
}

function updateText(node) {
    if (node.parentElement?.closest('script, style, textarea, input, [data-no-i18n], mjx-container')) return;
    const previous = textSources.get(node);
    if (previous?.shown === node.nodeValue) {
        if (language === previous.language) return;
    }
    const source = previous?.shown === node.nodeValue ? previous.source : node.nodeValue;
    const shown = translate(source);
    textSources.set(node, { source, shown, language });
    if (shown !== node.nodeValue) node.nodeValue = shown;
}

function updateAttributes(element) {
    let sources = attributeSources.get(element);
    if (!sources) { sources = new Map(); attributeSources.set(element, sources); }
    for (const name of attributes) {
        if (!element.hasAttribute(name)) continue;
        const current = element.getAttribute(name);
        const previous = sources.get(name);
        if (previous?.shown === current && previous.language === language) continue;
        const source = previous?.shown === current ? previous.source : current;
        const shown = translate(source);
        sources.set(name, { source, shown, language });
        if (shown !== current) element.setAttribute(name, shown);
    }
}

export function sourceAttribute(element, name) {
    const current = element.getAttribute(name);
    const previous = attributeSources.get(element)?.get(name);
    return previous?.shown === current ? previous.source : current;
}

// Translates `root` and everything in it now, without waiting for the MutationObserver.
export function translateTree(root) {
    update(root);
}

function update(root) {
    if (root.parentElement?.closest('script, style, textarea, input, [data-no-i18n], mjx-container')) return;
    if (root.nodeType === Node.TEXT_NODE) return updateText(root);
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    updateAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
        if (walker.currentNode.parentElement?.closest('script, style, textarea, input, [data-no-i18n], mjx-container')) continue;
        if (walker.currentNode.nodeType === Node.TEXT_NODE) updateText(walker.currentNode);
        else updateAttributes(walker.currentNode);
    }
}

const selector = document.getElementById('language-switch');
for (const [code, name] of Object.entries(languages)) selector.add(new Option(name, code));
selector.value = preferredLanguage;
document.documentElement.lang = language;
document.title = translate('Aniimax - Aniimo Production Optimizer');
update(document.body);
let languageRequest = 0;
async function selectLanguage(code) {
    const request = ++languageRequest;
    try { await load(code); } catch (error) {
        console.warn(error);
        if (request === languageRequest) selector.value = language;
        return;
    }
    if (request !== languageRequest) return;
    language = code;
    try { localStorage.setItem('aniimax-language', language); } catch (_) { /* Language still changes for this tab. */ }
    document.documentElement.lang = language;
    document.title = translate('Aniimax - Aniimo Production Optimizer');
    update(document.body);
    document.dispatchEvent(new Event('aniimax-language-change'));
}
selector.addEventListener('change', () => selectLanguage(selector.value));

new MutationObserver(records => {
    for (const record of records) {
        if (record.type === 'characterData') updateText(record.target);
        else if (record.type === 'attributes') updateAttributes(record.target);
        else record.addedNodes.forEach(update);
    }
}).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: attributes });

export const languageReady = selectLanguage(preferredLanguage);
