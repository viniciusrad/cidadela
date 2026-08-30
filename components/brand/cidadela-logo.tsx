import type { SVGProps } from "react";

/**
 * Marca Cidadela — torre/fortaleza com ameias (battlements).
 * Estilo de traço alinhado ao Lucide para encaixar onde antes ficava o ShieldCheck.
 * Usa `currentColor`, então herda a cor do texto (ex.: branco sobre o accent).
 */
export function CidadelaLogo(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {/* muralha com ameias */}
      <path d="M3 21V10H5V8H7V10H9V8H11V10H13V8H15V10H17V8H19V10H21V21Z" />
      {/* faixa da muralha */}
      <path d="M3 13.5H21" />
      {/* portão em arco */}
      <path d="M10 21v-4a2 2 0 0 1 4 0v4" />
    </svg>
  );
}

export default CidadelaLogo;
