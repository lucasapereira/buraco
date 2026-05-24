/**
 * withLocalizedAppName — config plugin do Expo que localiza o nome do app
 * no launcher (Android) e na home screen / App Store (iOS).
 *
 * Como funciona:
 *   - Android: cria `values-<locale>/strings.xml` com `<string name="app_name">…</string>`
 *     pra cada idioma. `values/strings.xml` (default) é mantido pelo Expo.
 *   - iOS: cria `<locale>.lproj/InfoPlist.strings` com `CFBundleDisplayName` e
 *     `CFBundleName`, e seta `CFBundleLocalizations` + `LSHasLocalizedDisplayName`
 *     no Info.plist principal pra iOS saber que existem traduções.
 *
 * Uso no app.json:
 *   "plugins": [
 *     ["./plugins/withLocalizedAppName", {
 *       "names": { "pt": "Queti's Buraco", "en": "Queti's Canasta", ... }
 *     }]
 *   ]
 *
 * Roda em `npx expo prebuild` (e implicitamente em `expo run:android` / `run:ios`).
 */

const { withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Mapeia chaves curtas (igual ao i18n) → códigos nativos.
// Android usa `r` antes do código de região (ex.: pt-rBR). iOS usa BCP-47 (pt-BR).
const LOCALE_MAP = {
  pt: { ios: 'pt-BR',   android: 'pt-rBR' },
  en: { ios: 'en',      android: 'en' },
  es: { ios: 'es',      android: 'es' },
  ru: { ios: 'ru',      android: 'ru' },
  it: { ios: 'it',      android: 'it' },
  zh: { ios: 'zh-Hans', android: 'zh-rCN' },
  lt: { ios: 'lt',      android: 'lt' },
  lv: { ios: 'lv',      android: 'lv' },
  et: { ios: 'et',      android: 'et' },
};

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Apóstrofo precisa de escape em Android XML resources (senão "Queti's" quebra)
    .replace(/'/g, "\\'");
}

function escapeIosStrings(s) {
  return String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const withLocalizedAppName = (config, { names = {} } = {}) => {
  if (!names || Object.keys(names).length === 0) return config;

  // ── ANDROID ───────────────────────────────────────────────────────────────
  config = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const resPath = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app', 'src', 'main', 'res',
      );
      for (const [appLocale, appName] of Object.entries(names)) {
        const androidLocale = LOCALE_MAP[appLocale]?.android;
        if (!androidLocale) continue;
        const valuesDir = path.join(resPath, `values-${androidLocale}`);
        fs.mkdirSync(valuesDir, { recursive: true });
        const stringsPath = path.join(valuesDir, 'strings.xml');
        const xml =
`<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">${escapeXml(appName)}</string>
</resources>
`;
        fs.writeFileSync(stringsPath, xml, 'utf8');
      }
      return modConfig;
    },
  ]);

  // ── iOS ───────────────────────────────────────────────────────────────────
  // 1) Cria <locale>.lproj/InfoPlist.strings em cada idioma
  config = withDangerousMod(config, [
    'ios',
    async (modConfig) => {
      const projectName = modConfig.modRequest.projectName;
      if (!projectName) return modConfig;
      const iosRoot = path.join(modConfig.modRequest.platformProjectRoot, projectName);
      // Se o ios/ ainda não foi gerado (projeto sem ios prebuild rodado), pula.
      if (!fs.existsSync(iosRoot)) return modConfig;
      for (const [appLocale, appName] of Object.entries(names)) {
        const iosLocale = LOCALE_MAP[appLocale]?.ios;
        if (!iosLocale) continue;
        const lprojDir = path.join(iosRoot, `${iosLocale}.lproj`);
        fs.mkdirSync(lprojDir, { recursive: true });
        const stringsPath = path.join(lprojDir, 'InfoPlist.strings');
        const escaped = escapeIosStrings(appName);
        const contents =
`/* Localized launcher / home screen name */
"CFBundleDisplayName" = "${escaped}";
"CFBundleName" = "${escaped}";
`;
        fs.writeFileSync(stringsPath, contents, 'utf8');
      }
      return modConfig;
    },
  ]);

  // 2) Adiciona os InfoPlist.strings ao .pbxproj como PBXVariantGroup.
  //    Sem isso, Xcode ignora os arquivos das pastas .lproj/ e nenhuma tradução
  //    do nome chega no bundle. iOS exige que recursos localizados sejam
  //    agrupados num VariantGroup, com PBXFileReference por idioma.
  config = withXcodeProject(config, (modConfig) => {
    const project = modConfig.modResults;
    const iosLocales = Object.keys(names)
      .map((k) => LOCALE_MAP[k]?.ios)
      .filter(Boolean);

    // Registra cada locale como knownRegion (faz o Xcode reconhecer o idioma)
    for (const loc of iosLocales) {
      project.addKnownRegion(loc);
    }

    // Cria (ou reusa) o PBXVariantGroup pra InfoPlist.strings, depois adiciona
    // uma PBXFileReference por idioma. addLocalizationVariantGroup já cuida
    // de criar o group e atrelar ao Resources phase.
    let variantGroupKey = project.findPBXVariantGroupKey({ name: 'InfoPlist.strings' });
    if (!variantGroupKey) {
      project.addLocalizationVariantGroup('InfoPlist.strings');
      variantGroupKey = project.findPBXVariantGroupKey({ name: 'InfoPlist.strings' });
    }
    const variantGroups = project.hash.project.objects.PBXVariantGroup;
    const variantGroup = variantGroups[variantGroupKey];
    const existingLocales = new Set(
      (variantGroup.children || []).map((c) => c.comment),
    );

    const fileRefs = project.hash.project.objects.PBXFileReference;
    for (const locale of iosLocales) {
      if (existingLocales.has(locale)) continue;
      const fileRefUUID = project.generateUuid();
      fileRefs[fileRefUUID] = {
        isa: 'PBXFileReference',
        lastKnownFileType: 'text.plist.strings',
        name: locale,
        path: `${locale}.lproj/InfoPlist.strings`,
        sourceTree: '"<group>"',
      };
      fileRefs[`${fileRefUUID}_comment`] = locale;
      variantGroup.children = variantGroup.children || [];
      variantGroup.children.push({ value: fileRefUUID, comment: locale });
    }

    return modConfig;
  });

  // 3) Declara CFBundleLocalizations no Info.plist principal e habilita
  //    LSHasLocalizedDisplayName pra iOS aplicar as traduções
  config = withInfoPlist(config, (modConfig) => {
    const iosLocales = Object.keys(names)
      .map((k) => LOCALE_MAP[k]?.ios)
      .filter(Boolean);
    modConfig.modResults.CFBundleLocalizations = iosLocales;
    modConfig.modResults.LSHasLocalizedDisplayName = true;
    // Força pt-BR como idioma "fonte" do app. Expo seta `$(DEVELOPMENT_LANGUAGE)`
    // por default (= 'en' do Xcode), o que não bate com o app que é primariamente
    // em português. Sobrescrevemos pra refletir a realidade do produto.
    modConfig.modResults.CFBundleDevelopmentRegion = 'pt-BR';
    return modConfig;
  });

  return config;
};

module.exports = withLocalizedAppName;
