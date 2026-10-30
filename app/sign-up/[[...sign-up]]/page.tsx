import { SignUp } from "@clerk/nextjs";
import { Suspense } from "react";

export default function SignUpPage() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-bg">
      <Suspense>
        <SignUp />
      </Suspense>
    </div>
  );
}
