from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    app_name: str = "trade-exec-bot"
    app_env: str = Field(default="development", alias="APP_ENV")
    app_port: int = Field(default=8091, alias="APP_PORT")

    webhook_secret: str = Field(alias="BOT_WEBHOOK_SECRET")
    allowlist_ips: str = Field(default="", alias="BOT_ALLOWLIST_IPS")

    exchange_name: str = Field(default="mexc", alias="EXCHANGE_NAME")
    mexc_api_key: str = Field(default="", alias="MEXC_API_KEY")
    mexc_api_secret: str = Field(default="", alias="MEXC_API_SECRET")
    mexc_api_password: str = Field(default="", alias="MEXC_API_PASSWORD")
    mexc_sandbox: bool = Field(default=False, alias="MEXC_SANDBOX")

    cooldown_seconds: int = Field(default=30, alias="BOT_COOLDOWN_SECONDS")
    max_open_orders_per_symbol: int = Field(default=5, alias="BOT_MAX_OPEN_ORDERS_PER_SYMBOL")
    daily_loss_cap_enabled: bool = Field(default=False, alias="BOT_DAILY_LOSS_CAP_ENABLED")

    daxlinks_internal_url: str = Field(
        default="http://localhost:4000/api/v1/internal/bot/order-result",
        alias="DAXLINKS_INTERNAL_URL",
    )
    daxlinks_internal_token: str = Field(default="", alias="DAXLINKS_INTERNAL_TOKEN")
    daxlinks_workspace_id_fallback: str = Field(default="", alias="DAXLINKS_WORKSPACE_ID_FALLBACK")
    daxlinks_bot_id_fallback: str = Field(default="", alias="DAXLINKS_BOT_ID_FALLBACK")
    daxlinks_bot_instance_id_fallback: str = Field(default="", alias="DAXLINKS_BOT_INSTANCE_ID_FALLBACK")

    http_timeout_seconds: float = Field(default=12.0, alias="HTTP_TIMEOUT_SECONDS")

    @property
    def allowlisted_ip_set(self) -> set[str]:
        return {
            entry.strip()
            for entry in self.allowlist_ips.split(",")
            if entry.strip()
        }
