import type {ValidateFunction} from 'ajv';
import type {ThemeDefinitionV1, ThemePackageManifestV1} from '@/types/themePackage';

export const validateDefinition: ValidateFunction<ThemeDefinitionV1>;
export const validateManifest: ValidateFunction<ThemePackageManifestV1>;
