import type { SystemRole } from "@prisma/client";
import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      role: SystemRole;
      companyId: string;
    } & DefaultSession["user"];
  }

  interface User {
    role: SystemRole;
    companyId: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    role?: SystemRole;
    companyId?: string;
  }
}
