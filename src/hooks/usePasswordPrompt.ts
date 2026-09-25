import { useContext } from "react";
import { PasswordPromptContext } from "../contexts/PasswordPromptContext";

export const usePasswordPrompt = () => useContext(PasswordPromptContext);
