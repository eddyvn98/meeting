/** Print stylesheet for the browser/PDF path.
 *
 * The on-screen Minutes tables intentionally have horizontal scroll and
 * minimum widths for editing. Those constraints must not leak into print:
 * on A4 they can clip the right-hand columns, and fixed-height app shells can
 * stop pagination after the first page. Print uses the full A4 content box,
 * fixed table layout, wrapping cells, repeated headers, and visible overflow.
 */
export function MinutesPrintStyles() {
	return (
		<style jsx global>{`
			@page {
				size: A4 portrait;
				margin: 12mm;
			}

			@media print {
				html,
				body {
					height: auto !important;
					min-height: 0 !important;
					overflow: visible !important;
					background: #fff !important;
				}

				body * {
					visibility: hidden;
				}

				#minutes-print-root,
				#minutes-print-root * {
					visibility: visible;
				}

				#minutes-print-root {
					position: absolute !important;
					left: 0 !important;
					top: 0 !important;
					width: 100% !important;
					max-width: none !important;
					margin: 0 !important;
					padding: 0 !important;
					overflow: visible !important;
					border: 0 !important;
					border-radius: 0 !important;
					box-shadow: none !important;
					background: #fff;
					color: #000;
					--background: 0 0% 100%;
					--foreground: 222.2 84% 4.9%;
					--card: 0 0% 100%;
					--card-foreground: 222.2 84% 4.9%;
					--muted: 210 40% 96%;
					--muted-foreground: 215.4 16.3% 46.9%;
					--border: 214.3 31.8% 91.4%;
				}

				/* Editing containers scroll horizontally on screen. In print
				   they must expand into the page box instead of clipping. */
				#minutes-print-root .overflow-x-auto {
					overflow: visible !important;
				}

				#minutes-print-root table {
					width: 100% !important;
					min-width: 0 !important;
					max-width: 100% !important;
					table-layout: fixed !important;
				}

				#minutes-print-root th,
				#minutes-print-root td {
					white-space: normal !important;
					overflow-wrap: anywhere !important;
					word-break: break-word !important;
				}

				/* Match the DOCX proportions so all four MOM columns fit A4. */
				#minutes-print-root .minutes-main-table th:nth-child(1),
				#minutes-print-root .minutes-main-table td:nth-child(1) {
					width: 7%;
				}
				#minutes-print-root .minutes-main-table th:nth-child(2),
				#minutes-print-root .minutes-main-table td:nth-child(2) {
					width: 48%;
				}
				#minutes-print-root .minutes-main-table th:nth-child(3),
				#minutes-print-root .minutes-main-table td:nth-child(3) {
					width: 27%;
				}
				#minutes-print-root .minutes-main-table th:nth-child(4),
				#minutes-print-root .minutes-main-table td:nth-child(4) {
					width: 18%;
				}

				#minutes-print-root .minutes-attendance-table th:nth-child(1),
				#minutes-print-root .minutes-attendance-table td:nth-child(1) {
					width: 34%;
				}
				#minutes-print-root .minutes-attendance-table th:nth-child(2),
				#minutes-print-root .minutes-attendance-table td:nth-child(2) {
					width: 24%;
				}
				#minutes-print-root .minutes-attendance-table th:nth-child(3),
				#minutes-print-root .minutes-attendance-table td:nth-child(3) {
					width: 24%;
				}
				#minutes-print-root .minutes-attendance-table th:nth-child(4),
				#minutes-print-root .minutes-attendance-table td:nth-child(4) {
					width: 18%;
				}

				thead {
					display: table-header-group;
				}

				tfoot {
					display: table-footer-group;
				}

				/* Long rows are allowed to continue on the next page instead of
				   being pushed outside the printable page. */
				#minutes-print-root tr {
					break-inside: auto;
					page-break-inside: auto;
				}
			}
		`}</style>
	);
}
