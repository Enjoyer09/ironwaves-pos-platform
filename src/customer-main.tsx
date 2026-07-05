import React from "react";
import { Capacitor } from "@capacitor/core";
import CustomerApp from "./components/CustomerApp";
import { readCustomerSession, readCustomerSessionAsync } from "./lib/customer_session";

type CustomerAppParams = {
  cardId: string;
  token: string;
  join: boolean;
};

function getCustomerAppParams(): CustomerAppParams {
  if (typeof window === "undefined") {
    return { cardId: "", token: "", join: false };
  }

  const isMobile = Capacitor.isNativePlatform();
  if (isMobile) {
    const { cardId: savedCardId, token: savedToken } = readCustomerSession();
    return {
      cardId: savedCardId,
      token: savedToken,
      join: !savedCardId || !savedToken,
    };
  }

  const params = new URLSearchParams(window.location.search);
  const { cardId: savedCardId, token: savedToken } = readCustomerSession();
  const isReturningCustomer = params.get("customer") === "1";
  const urlCardId = params.get("id") || "";
  const urlToken = params.get("t") || params.get("token") || "";

  return {
    cardId: urlCardId || (isReturningCustomer ? savedCardId : ""),
    token: urlToken || (isReturningCustomer ? savedToken : ""),
    join: params.get("join") === "1" || (isReturningCustomer && (!savedCardId || !savedToken)),
  };
}

export default function CustomerMain() {
  const [customerAppParams, setCustomerAppParams] = React.useState<CustomerAppParams | null>(() =>
    Capacitor.isNativePlatform() ? null : getCustomerAppParams()
  );

  React.useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let cancelled = false;

    void (async () => {
      const session = await readCustomerSessionAsync();
      if (cancelled) return;
      setCustomerAppParams({
        cardId: session.cardId,
        token: session.token,
        join: !session.cardId || !session.token,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (!customerAppParams) {
    return <div className="min-h-screen bg-slate-950" />;
  }

  return (
    <CustomerApp
      cardId={customerAppParams.cardId}
      token={customerAppParams.token}
      joinMode={customerAppParams.join}
    />
  );
}
