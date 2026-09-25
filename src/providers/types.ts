export type ProviderCapability =
  | "filesystem"
  | "shell"
  | "git"
  | "transaction"
  | "browser"
  | "desktop";

export interface ProviderStatus {
  id: string;
  label: string;
  enabled: boolean;
  available: boolean;
  capabilities: ProviderCapability[];
  details?: Record<string, unknown>;
}

export interface ComputerProvider {
  readonly id: string;
  readonly label: string;
  status(): Promise<ProviderStatus>;
}
