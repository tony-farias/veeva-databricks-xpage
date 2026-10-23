# Function App folder moved

The Ping/Kong broker, Azure Functions host, settings templates, tests, and packaging script now live in [`../function-app/`](../function-app/).

From the repository root:

```bash
cd pingid/function-app
npm ci
npm test
npm run package:functions
```

Deploy `pingid/function-app/artifacts/broker-functions.zip` to Azure. The X-Page ZIP is a separate package for Veeva.

See the [deployment steps for an existing Function App](../function-app/DEPLOYMENT.md).
