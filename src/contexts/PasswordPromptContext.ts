import { createContext } from "react";
import type { RequestPassword } from "../utils/connectionPassword";

export interface PasswordPromptContextType {
  requestPassword: RequestPassword;
}

export const PasswordPromptContext = createContext<PasswordPromptContextType>({
  requestPassword: () => Promise.resolve(null),
});
