import { useContext } from "react";
import { UpdateContext } from "../contexts/UpdateContext";

export const useUpdate = () => {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error("useUpdate must be used within UpdateProvider");
  }
  return context;
};
