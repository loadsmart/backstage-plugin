import { Config } from '@backstage/config';
import { createApiRef } from '@backstage/core-plugin-api';
import { Entity, stringifyEntityRef } from '@backstage/catalog-model';
import { GraphQLClient, gql } from 'graphql-request';
import { OpsLevelApi } from './types/OpsLevelData';

export const opslevelApiRef = createApiRef<OpsLevelApi>({
  id: 'plugin.opslevel.service',
});

export class OpsLevelGraphqlAPI implements OpsLevelApi {
  static fromConfig(config: Config) {
    return new OpsLevelGraphqlAPI(config.getString('backend.baseUrl'),
                                 config.getOptionalStringArray('opslevel.frameworks') ?? ['']);
  }

  private client;

  constructor(public url: string, public frameworks: string[]) {
    this.client = new GraphQLClient(`${this.url}/api/proxy/opslevel/graphql`);
  }

  getServiceMaturityByAlias(serviceAlias: string) {
    const query = gql`
      query getServiceMaturityForBackstage($alias: String!) {
        account {
          rubric {
            levels {
              nodes {
                index
                name
                description
              }
            }
          }
          service(alias: $alias) {
            htmlUrl
            maturityReport {
              overallLevel {
                index
                name
                description
              }
              categoryBreakdown {
                category {
                  name
                }
                level {
                  name
                }
              }
            }
            serviceStats {
              rubric {
                checkResults {
                  byLevel {
                    nodes {
                      level {
                        index
                        name
                      }
                      items {
                        nodes {
                          message
                          warnMessage
                          createdAt
                          check {
                            id
                            enableOn
                            name
                            type
                            category {
                              name
                            }
                          }
                          status
                        }
                      }
                    }
                  }
                }
              }
            }
            checkStats {
              totalChecks
              totalPassingChecks
            }
          }
        }
      }
    `;

    return this.client.request(query, { alias: serviceAlias }, { "GraphQL-Visibility": "internal" });
  }

  getServicesReport() {
    const query = gql`
      query servicesReport {
        account {
          rubric {
            levels {
              totalCount
              nodes {
                index
                name
                alias
              }
            }
            categories {
              nodes {
                id
                name
              }
            }
          }
          servicesReport {
            levelCounts {
              level {
                name
              }
              serviceCount
            }
            categoryLevelCounts {
              category {
                name
              }
              level {
                name
                index
              }
              serviceCount
            }
          }
        }
      }    
    `;

    return this.client.request(query, { }, { "GraphQL-Visibility": "internal" });
  }

  exportEntity(entity: Entity) {

    const importEntityFromBackstage = `
    mutation import($entityRef: String!, $entity: JSON!) {
      import: importEntityFromBackstage(entityRef: $entityRef, entity: $entity) {
        errors {
          message
        }
        actionMessage
        htmlUrl
      }
    }
    `;

    let response = Promise.resolve(null)

    entity.metadata.tags?.push(`type:${entity.spec?.type}`);
    if (entity.spec) {
      entity.spec.type = "service";
    }

    const input = {
      entityRef: stringifyEntityRef(entity),
      entity: entity,
      entityAlias: entity.metadata.name,
    };
    response =  this.client.request(importEntityFromBackstage, input);

    return response
  }

  updateService(entity: Entity) {
    const getServiceLanguage = `
      query getServiceLanguage($alias: String!) {
        account {
          service(alias: $alias) {
            name
            repos {
              edges {
                node {
                  languages {
                    name
                    usage
                  }
                }
              }
            }
          }
        }
      }
    `;

    const serviceUpdate = `
      mutation serviceUpdate($alias: String!, $language: String, $framework: String) {
        serviceUpdate(input: {alias: $alias, language: $language, framework: $framework}) {
          errors {
            message
          }
        }
      }
    `;

    const entityAlias = entity.metadata.name

    let response = Promise.resolve(null)
    let framework: string | undefined;

    this.client.request(getServiceLanguage, { alias: entityAlias }).then((result) => {

      const repos = result.account.service.repos.edges[0].node;
      const languages: {name: string, usage: number}[] = repos.languages;

      const primaryLanguage = languages.reduce((prev, curr) =>
                                               curr.usage > prev.usage ? curr : prev, languages[0]);

      framework = entity.metadata.annotations?.["opslevel.com/framework"]
      if (framework === undefined) {
        framework = entity.metadata.tags?.find(tag => this.frameworks.includes(tag));
      }

      response = this.client.request(serviceUpdate, { alias: entityAlias,
                                                      language: primaryLanguage?.name,
                                                      framework: framework,
                                                      })
    });

    return response

  }

}
