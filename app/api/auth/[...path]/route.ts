import { getAuth } from "@/lib/auth/server";

export const { GET, POST, PUT, PATCH, DELETE } = getAuth().handler();
