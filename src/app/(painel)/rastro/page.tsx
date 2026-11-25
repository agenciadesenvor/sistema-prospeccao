import Link from "next/link";

import { BuscaRastro } from "@/components/busca-rastro";
import { ativo } from "@/lib/config";
import { db } from "@/lib/db";

export const metadata = { title: "Rastro" };
// A busca (Server Action desta página) espera o Rastro, que pode levar até ~100 s.
export const maxDuration = 120;

export default async function Rastro() {
  const [cfg, achados] = await Promise.all([ativo("rastro"), db.negocio.count({ where: { origem: "rastro" } })]);
  return (
    <>
      <header className="mb-8 max-w-[720px]">
        <p className="sobrelinha mb-2">Operação</p>
        <h1 className="text-[34px] leading-[1.02] sm:text-[44px]">O que vamos garimpar hoje?</h1>
        <p className="mt-3 text-[16px] text-tinta-3">
          O Rastro procura no Google Maps com um navegador de verdade. Sem site, nota alta e celular é o alvo mais quente.
          {achados > 0 && <> Já trouxe <b className="font-semibold text-tinta">{achados}</b> para a esteira.</>}
        </p>
      </header>
      {!cfg && (
        <div className="mb-6 rounded-[14px] border border-alerta/30 bg-alerta-suave px-5 py-4 text-[14px] text-alerta">
          O Rastro ainda não está ligado.{" "}
          <Link href="/conexoes?g=rastro" className="link text-alerta">
            Ligar em Conexões
          </Link>
          .
        </div>
      )}
      <BuscaRastro />
    </>
  );
}
