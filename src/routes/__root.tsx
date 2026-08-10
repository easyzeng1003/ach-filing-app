import { HeadContent, Outlet, Scripts, createRootRoute } from "@tanstack/react-router";
import { ToastHost } from "@/components/ui/toast-host";
import { AppProviders } from "@/theme/AppProviders";
import appCss from "@/styles.css?url";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "ACH改檔小工具 — ACH 格式參數化" },
      {
        name: "description",
        content:
          "財金 ACH 代收建檔：檔案代號與欄位格式以 JSON 參數化，產生固定長度上傳檔",
      },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Noto+Sans+TC:wght@400;500;600;700&family=JetBrains+Mono:wght@400;600&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="zh-Hant">
      <head>
        <HeadContent />
      </head>
      <body>
        <AppProviders>
          <Outlet />
          <ToastHost />
        </AppProviders>
        <Scripts />
      </body>
    </html>
  );
}
