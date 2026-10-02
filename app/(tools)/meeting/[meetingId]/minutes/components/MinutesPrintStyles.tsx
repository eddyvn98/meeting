/** Print stylesheet: hides the app chrome/toolbar around the document
 *  (identified by the `minutes-print-root`/`print:hidden` classes below)
 *  and repeats each table's header row on every printed page. */
export function MinutesPrintStyles() {
	return (
		<style jsx global>{`
			@media print {
				body * {
					visibility: hidden;
				}
				#minutes-print-root,
				#minutes-print-root * {
					visibility: visible;
				}
				#minutes-print-root {
					position: absolute;
					left: 0;
					top: 0;
					width: 100%;
				}
				thead {
					display: table-header-group;
				}
				/* The page is always printed as black on white, even from dark mode. */
				#minutes-print-root {
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
			}
		`}</style>
	);
}
