import { useTranslation } from "react-i18next";
import clsx from "clsx";
import {
  ENVIRONMENT_BADGE_CLASSES,
  environmentLabelKey,
  type ConnectionEnvironment,
} from "../../utils/environment";

/** Small colored chip naming the connection's environment (DEV/STAGING/PROD). */
export const EnvironmentBadge = ({
  environment,
}: {
  environment?: ConnectionEnvironment;
}) => {
  const { t } = useTranslation();
  if (!environment) return null;
  return (
    <span
      className={clsx(
        "text-[10px] font-bold px-1.5 py-0.5 rounded-md border uppercase tracking-wide",
        ENVIRONMENT_BADGE_CLASSES[environment],
      )}
    >
      {t(environmentLabelKey(environment))}
    </span>
  );
};
