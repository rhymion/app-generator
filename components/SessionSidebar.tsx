"use client";

import { useSession } from "next-auth/react";
import Sidebar from "../app/@sidebar/page";

export default function SessionSidebar() {
  const { data: session } = useSession();
  if (!session) return null;
  return <Sidebar />;
}
