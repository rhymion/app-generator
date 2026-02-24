import { themeConfig } from "@/lib/site-config";

export default function FooterPage() {
  return (
    <footer className={`text-sm p-3 text-center ${themeConfig.footer.bar}`}>
      Copyright © 2026 Rhymion Labs. All Rights Reserved.
    </footer>
  );
}
