import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import SourceEditor from "../components/SourceEditor";
import { stateQuery } from "../query";

/** A project in the editor: LaTeX on the left, the PDF on the right. */
export default function EditorPage() {
  const { id = "" } = useParams();
  const nav = useNavigate();
  const state = useQuery(stateQuery(id));
  if (state.error) {
    const e = state.error as { message?: string; hint?: string };
    return (
      <main className="home">
        <h1>This project can't be opened</h1>
        <p>{e.message}</p>{e.hint && <p className="muted">{e.hint}</p>}
        <Link to="/">← All projects</Link>
      </main>
    );
  }
  if (!state.data) return <main className="home"><p className="muted">Opening…</p></main>;
  return (
    <SourceEditor key={id} name={id} main={state.data.main} pdf={state.data.pdf} pdfMtime={state.data.pdfMtime}
                  onClose={() => nav("/")} onSwitch={(to) => nav(`/p/${to}`)} />
  );
}
