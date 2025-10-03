import { keystoneContext } from '../../features/keystone/context'
import { createYoga } from "graphql-yoga";
import { type NextApiRequest, type NextApiResponse } from 'next'

export const config = {
  api: {
    bodyParser: false,
  },
};

export default createYoga({
  renderGraphiQL: () => {
    return `
      <!DOCTYPE html>
      <html lang="en">
        <body style="margin: 0; overflow-x: hidden; overflow-y: hidden">
        <div id="sandbox" style="height:100vh; width:100vw;"></div>
        <script src="https://embeddable-sandbox.cdn.apollographql.com/_latest/embeddable-sandbox.umd.production.min.js"></script>
        <script>
        new window.EmbeddedSandbox({
          target: "#sandbox",
          // Pass through your server href if you are embedding on an endpoint.
          // Otherwise, you can pass whatever endpoint you want Sandbox to start up with here.
          initialEndpoint: window.location.href,
          hideCookieToggle: false,
          initialState: {
            includeCookies: true
          }
        });
        // advanced options: https://www.apollographql.com/docs/studio/explorer/sandbox#embedding-sandbox
        </script>
        </body>
      </html>`;
  },
  graphqlEndpoint: "/api/graphql",
  schema: keystoneContext.graphql.schema,
  context: ({ req, res }: { req: NextApiRequest; res: NextApiResponse }) => {
    return keystoneContext.withRequest(req, res);
  },
})