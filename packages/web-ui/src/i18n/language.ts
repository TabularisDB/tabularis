import {SUPPORTED_LANGUAGES, type AppLanguage} from './config';

type SupportedLanguageId = (typeof SUPPORTED_LANGUAGES)[number]['id'];

const DEFAULT_LANGUAGE: SupportedLanguageId = 'en';

// Base locale codes served by another dictionary (config.ts falls back fil -> tl).
const LANGUAGE_ALIASES: Readonly<Record<string, SupportedLanguageId>> = {
    fil: 'tl',
};

// Full locale tags (or their leading subtags) served by a regional dictionary.
// Traditional Chinese locales use zh-TW; zh, zh-CN and zh-Hans keep Simplified Chinese.
const LOCALE_TAG_ALIASES: Readonly<Record<string, SupportedLanguageId>> = {
    'zh-hant': 'zh-TW',
    'zh-hk': 'zh-TW',
    'zh-mo': 'zh-TW',
};

function findLocaleTagAlias(wanted: string): SupportedLanguageId | undefined {
    const subtags = wanted.split('-');
    for (let length = subtags.length; length > 1; length--) {
        const alias = LOCALE_TAG_ALIASES[subtags.slice(0, length).join('-')];
        if (alias) return alias;
    }
    return undefined;
}

function findSupportedLanguageId(locale?: string): SupportedLanguageId | undefined {
    if (!locale) return undefined;
    const wanted = locale.replace('_', '-').toLowerCase();
    const exact = SUPPORTED_LANGUAGES.find(({id}) => id.toLowerCase() === wanted);
    if (exact) return exact.id;
    const tagAlias = findLocaleTagAlias(wanted);
    if (tagAlias) return tagAlias;
    const base = wanted.split('-')[0];
    const alias = LANGUAGE_ALIASES[base];
    if (alias) return alias;
    return SUPPORTED_LANGUAGES.find(({id}) => {
        const supported = id.toLowerCase();
        return supported === base || supported.startsWith(`${base}-`);
    })?.id;
}

function findSupportedLanguageLabel(locale?: string): string | undefined {
    const id = findSupportedLanguageId(locale);
    return SUPPORTED_LANGUAGES.find((language) => language.id === id)?.label;
}

export function resolveAutoLanguage(
    locales?: readonly (string | undefined | null)[] | string | null,
): SupportedLanguageId {
    const candidates = typeof locales === 'string' ? [locales] : (locales ?? []);
    for (const locale of candidates) {
        const id = findSupportedLanguageId(locale ?? undefined);
        if (id) return id;
    }
    return DEFAULT_LANGUAGE;
}

export function getAiExplanationLanguage(language: AppLanguage, resolvedLanguage?: string): string {
    const fallBackLanguage = 'English';

    if (language === 'auto') {
        return findSupportedLanguageLabel(resolvedLanguage) ?? fallBackLanguage;
    }

    const supportedLanguage = SUPPORTED_LANGUAGES.find(({id}) => id === language);
    return supportedLanguage?.label || fallBackLanguage;
}
