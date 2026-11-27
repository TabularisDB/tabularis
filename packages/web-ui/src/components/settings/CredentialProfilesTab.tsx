import {useTranslation} from 'react-i18next';
import {SettingSection} from './SettingControls';
import {CredentialProfilesManager} from '@/components/credentialProfiles/CredentialProfilesManager';

export function CredentialProfilesTab() {
    const {t} = useTranslation();

    return (
        <div>
            <SettingSection
                title={t('credentialProfiles.title')}
                description={t('credentialProfiles.manageDesc')}
            >
                <CredentialProfilesManager />
            </SettingSection>
        </div>
    );
}
