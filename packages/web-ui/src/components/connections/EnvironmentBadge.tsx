import { useTranslation } from "react-i18next";
import { Chip } from "../ui/Chip";
import {
  ENVIRONMENT_TONES,
  environmentLabelKey,
  type ConnectionEnvironment,
} from "../../utils/environment";

/** Small toned chip naming the connection's environment (DEV/STAGING/PROD). */
export const EnvironmentBadge = ({
  environment,
}: {
  environment?: ConnectionEnvironment;
}) => {
  const { t } = useTranslation();
  if (!environment) return null;
  return (
    <Chip tone={ENVIRONMENT_TONES[environment]} uppercase>
      {t(environmentLabelKey(environment))}
    </Chip>
  );
};
