// An event as the rear opens it, from a notification or the history. An
// open event is worked on from the rear's screen, filtered to it; a closed
// or cancelled one shows the company's list read-only.
import { useParams } from "react-router-dom";
import { Layout } from "../../components/Layout";
import { useEvent } from "../../hooks/useEvent";
import { CustomerEvent } from "../customer/CustomerEvent";
import { RearHome } from "./RearHome";
import { t } from "../../strings";

export function RearEvent() {
  const { id } = useParams();
  const { event } = useEvent(id);
  if (event === undefined) return <Layout title={t.loading} back>{null}</Layout>;
  if (event === null) return <Layout title={t.genericError} back>{null}</Layout>;
  return event.status === "open" ? <RearHome /> : <CustomerEvent />;
}
