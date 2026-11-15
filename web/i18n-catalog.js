// Catalog translation without DOM state, shared by page text, attributes and regression tests.
const SLOT = /\{[a-z_]+\}/gi;
const NUMBER = /^\{(?:days|hours|minutes|seconds|n|level|trips|distance|plots|used|limit|active|total|capacity|working|have)\}$/;
const SENTENCES = /(?<!Lv\.)(?<=[.!?])\s+(?=[A-Z0-9])/;
const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function compileTemplates(catalog) {
    return Object.entries(catalog)
        .filter(([source]) => /\{[a-z_]+\}/i.test(source))
        .sort(([a], [b]) => b.replace(SLOT, "").length - a.replace(SLOT, "").length || b.length - a.length)
        .map(([source, target]) => {
            const slots = [...source.matchAll(SLOT)].map(match => match[0]);
            const parts = source.split(SLOT);
            const pattern = parts.map((part, i) => escapeRegExp(part) + (i < slots.length
                ? NUMBER.test(slots[i]) ? '([0-9][0-9.,\\s]*)'
                    : slots[i] === '{time}' ? '([0-9].*?)' : '(.+?)'
                : '')).join('');
            // Short wrappers must not consume a whole list or sentence as one item.
            const broad = (source.replace(SLOT, '').match(/[a-z]+/gi) || []).length <= 2
                && !source.includes(': ') && !source.includes(', ') && !source.startsWith('~');
            return { pattern: new RegExp(`^${pattern}$`), slots, target, broad, startsWithSlot: source.startsWith('{') };
        });
}

export function translateCatalog(value, catalog = {}, templates = []) {
    if (!value) return value;
    const text = value.trim();
    const translated = catalog[text];
    const replace = result => value.replace(text, () => result);
    if (translated) return replace(translated);
    const translate = part => translateCatalog(part, catalog, templates);
    const split = separator => {
        const parts = text.split(separator);
        if (parts.length < 2) return null;
        const localized = parts.map(translate);
        return localized.some((part, i) => part !== parts[i])
            ? replace(localized.join(typeof separator === 'string' ? separator : ' ')) : null;
    };
    // These delimit independent messages; in particular, don't split a decimal or "Lv. 3".
    for (const separator of ['\n', ' · ', SENTENCES]) {
        const result = split(separator);
        if (result !== null) return result;
    }
    const render = template => {
        const match = text.match(template.pattern);
        if (!match) return null;
        // A suffix for one item must not swallow a semicolon-separated checklist.
        if (template.startsWithSlot && match.slice(1).some(value => value.includes('; '))) return null;
        const values = new Map(template.slots.map((slot, i) => [slot,
            match[i + 1] === text ? match[i + 1] : translate(match[i + 1])]));
        return replace(template.target.replace(SLOT, slot => values.get(slot)));
    };
    for (const template of templates.filter(t => !t.broad)) {
        const result = render(template);
        if (result !== null) return result;
    }
    for (const separator of ['; ', ', ']) {
        const result = split(separator);
        if (result !== null) return result;
    }
    for (const template of templates.filter(t => t.broad)) {
        const result = render(template);
        if (result !== null) return result;
    }
    return value;
}
